'use strict';
var env = require('./env');
var utils = require('./utils');
var logger = utils.logger;
var auth = require('./auth');
var sms = require('./sms');
var promise = require('promise');
var extend = require('extend');
var json = require('json3');
var querystring = require('querystring');
var entities = require('html-entities').AllHtmlEntities;
var nodemailer = require('nodemailer');
var google = require('googleapis');
var gmail = google.gmail('v1');
var gcloud = require('gcloud')({
	projectId: env.google_project_id,
	credentials: json.parse(env.google_cloud_json),
});

// set up oauth credentials for our gmail account
var oauth = new google.auth.OAuth2(
	env.google_client_id,
	env.google_client_secret
);

oauth.setCredentials({
	id: env.google_id,
	refresh_token: env.google_refresh_token,
});

google.options({ auth: oauth });

var parseEmailFromHeader = function(address) {
	// parse "First Last <first.last@example.com>" into "first.last@example.com"
	var regex = /.?([a-zA-Z0-9_.+-]+@[a-zA-Z0-9_.+-]+\.[a-zA-Z]{2,4}).?/g;
	var match = regex.exec(address);
	if (match) address = match[1];
	return address;
};

var parsePhoneNumbersFromEmail = function(address) {
	// parse "email.+12345678900.+19876543210@example.com" into ["+12345678900", "+19876543210"]
	var regex = /.*(\+\d+).(\+\d+)@.*/g;
	var phones = [];
	var match = regex.exec(address);
	if (match) {
		phones.push(match[1]);
		phones.push(match[2]);
	}
	return phones;
};

var parseBodyFromThread = function(body) {
	// parse "foo bar On Tuesday, January 5, email@example.com wrote: > baz qux" into "foo bar"
	var regex = /^(.+?)(?:\s*)(On.*@.*wrote.*)$/gm;
	var match = regex.exec(body);
	if (match) body = match[1];
	return body;
};

var generateReplyTo = function(hasAuth, from, to) {
	// given a from and to phone number, generate the email to SMS gateway address
	if (hasAuth && from && to) {
		if (to.indexOf('+') !== 0) {
			to = '+' + to;
		}
		var parts = env.google_id.split('@');
		return parts[0] + to + '.' + from + '@' + parts[1];
	} else {
		return 'no-reply@gmail.com';
	}
};

module.exports.generateDialerUrl = function(email, from, to) {
	// given an email, from, and to phone numbers, generate a link to the soft phone dialer
	var query = querystring.stringify({
		email: email,
		from: from,
		to: to,
	});
	return env.webtask_container + '/twilio-voice/dialer?' + query;
};

module.exports.generateLoginUrl = function(email) {
	// given an email, generate a link to login
	return env.auth0_login_url;
};

module.exports.generateHeaders = function(message) {
	// given an email message with phone numbers in from and to fields,
	// populate correct values for from, to, and reply-to SMTP headers
	var from = message.from;
	var to = message.to;
	var hasAuth = message.hasAuth;
	var replyTo = generateReplyTo(hasAuth, from, to);
	if (from) {
		message.from = '"' + (message.formattedPhone || from) + '" <' + env.google_id + '>';
	} else {
		message.from = env.google_id;
	}
	if (message.email) {
		message.to = message.email;
	}
	message.replyTo = replyTo;
	return message;
};

module.exports.sendGmail = function(message) {
	return promise.denodeify(oauth.getAccessToken.bind(oauth))()
	.then(function(token) {
		return nodemailer.createTransport({
			send: function(mail, callback) {
				promise.denodeify(mail.message.build.bind(mail.message))()
				.then(function(message) {
					logger.debug('sending email: ', mail);
					var base64 = new Buffer(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
					return promise.denodeify(gmail.users.messages.send)({
						userId: 'me',
						resource: { raw: base64 },
					});
				})
				.nodeify(callback);
			}
		});
	})
	.then(function(mailer) {
		return promise.denodeify(mailer.sendMail.bind(mailer))(message);
	});
};

var renewSubscriptionIfNecessary = function(data) {
	// check subscription status, renew if close to expiration, and update data
	return promise.resolve()
	.then(function() {
		var subscriptionId = (data && data.gmail && data.gmail.subscriptionId) || null;
		var expiration = (data && data.gmail && data.gmail.expiration) || 0;
		if (!subscriptionId || !expiration || expiration < new Date().getTime() + 86400) {
			// TODO renew sub
		}
	});
};

var receiveGmail = function(ctx, data) {
	// get oauth token
	return promise.denodeify(oauth.getAccessToken.bind(oauth))()
	// renew subscription for email push
	.then(renewSubscriptionIfNecessary.bind(null, data))
	// query for the user's email metadata
	.then(function() {
		var query = {
			userId: 'me',
			maxResults: 100,
			q: 'label:INBOX label:UNREAD {subject:"Re: SMS from" subject:"Re: Voicemail from"} to:' + env.google_id,
		};
		return promise.denodeify(gmail.users.messages.list)(query);
	})
	// turn around and fetch the data
	.then(function(response) {
		logger.debug('response:', response);
		var messages = response && response.messages ? response.messages : [];
		return promise.all(messages.map(function(message) {
			var get = {
				userId: 'me',
				id: message.id,
				format: 'full',
			};
			logger.debug('fetching message', message);
			return promise.denodeify(gmail.users.messages.get)(get);
		}));
	})
	// for all new messages, archive and mark as read
	.then(function(messages) {
		logger.debug('messages:', messages);
		var update = {
			userId: 'me',
			resource: {
				addLabelIds: [],
				removeLabelIds: ['INBOX', 'UNREAD'],
			},
		};
		return promise.all(messages.map(function(message) {
			return promise.denodeify(gmail.users.messages.modify)(extend(update, { id: message.id }));
		}))
		.then(function() {
			return messages;
		});
	})
	// update inbox state
	.then(function(messages) {
		ctx.storage.set(data, function (error) {
			if (error) {
				logger.error('failed to set data', err);
			}
		});
		return messages;
	})
	// transform message data into friendly format
	.then(function(messages) {
		return messages.map(function(message) {
			var payload = message.payload;
			return {
				id: message.id,
				threadId: message.threadId,
				from: payload.headers.filter(function(header) { return header.name === 'From'; })[0].value,
				to: payload.headers.filter(function(header) { return header.name === 'To'; })[0].value,
				body: new entities().decode(message.snippet),
				time: message.internalDate,
			};
		});
	});
};

var emailToSms = function(emails) {
	return promise.resolve(emails)
	// sort by email timestamp
	.then(function(emails) {
		return emails.sort(function(a, b) {
			return a.time - b.time;
		});
	})
	// convert emails to sms
	.then(function(emails) {
		logger.debug('received emails', emails);
		return promise.all(emails.map(function(email) {
			logger.debug('parsing email', email);
			var phones = parsePhoneNumbersFromEmail(email.to);
			var body = parseBodyFromThread(email.body);
			if (phones && phones.length == 2 && body) {
				return {
					email: parseEmailFromHeader(email.from),
					from: phones[0],
					to: phones[1],
					body: body,
				};
			} else {
				logger.error('unable to convert to sms', message);
			}
		}));
	})
	// filter nulls
	.then(utils.filterNulls)
	// attach user's twilio credentials
	.then(function(txts) {
		return promise.all(txts.map(function(txt) {
			return auth.getOrCreateUser(txt.email)
			.then(function(user) {
				if (auth.hasTwilioAuth(user)) {
					logger.debug('sending sms for user', user);
					txt.twilioAccountSid = user.app_metadata.twilio_account_sid;
					txt.twilioAuthToken = user.app_metadata.twilio_auth_token;
					return txt;
				} else {
					logger.warn('not sending sms for user with no twilio credentials', user);
				}
			});
		}));
	})
	// filter nulls
	.then(utils.filterNulls)
	// send sms
	.then(function(txts) {
		return promise.all(txts.map(sms.sendSms));
	});
};

module.exports.handleEmail = function(req, res) {
	var ctx = req.webtaskContext;
	// get inbox state
	return promise.denodeify(ctx.storage.get.bind(ctx.storage))({})
	// pull down latest emails
	.then(receiveGmail.bind(null, ctx))
	// send as SMS
	.then(emailToSms)
	// reply with success
	.then(function() { return res.status(200); });
};

