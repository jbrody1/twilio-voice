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

var identity = {
	id: env.google_id,
	refresh_token: env.google_refresh_token,
};

var oauth = new google.auth.OAuth2(
	env.google_client_id,
	env.google_client_secret
);
oauth.setCredentials(identity);
google.options({ auth: oauth });

var gmail = google.gmail('v1');

var gcloud = require('gcloud')({
	projectId: env.google_project_id,
	credentials: json.parse(env.google_cloud_json),
});

var parts = identity.id.split('@');
if (parts.length !== 2) {
	throw new Error('invalid gateway email: ' + gatewayEmail);
}

var parseEmailFromHeader = function(address) {
	var regex = /.?([a-zA-Z0-9_.+-]+@[a-zA-Z0-9_.+-]+\.[a-zA-Z]{2,4}).?/g;
	var match = regex.exec(address);
	if (match) address = match[1];
	return address;
};

var parsePhoneNumbersFromEmail = function(address) {
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
	var regex = /^(.+?)(?:\sOn.*@.*wrote.*)$/g;
	var match = regex.exec(body);
	if (match) body = match[1];
	return body;
};

var generateReplyTo = function(hasAuth, from, to) {
	if (hasAuth && from && to) {
		if (to.indexOf('+') !== 0) {
			to = '+' + to;
		}
		return parts[0] + to + '.' + from + '@' + parts[1];
	} else {
		return 'no-reply@gmail.com';
	}
};

module.exports.generateDialerUrl = function(mail, from, to) {
	var query = querystring.stringify({
		email: mail,
		from: from,
		to: to,
	});
	return env.webtask_container + '/twilio-voice/dialer?' + query;
};

module.exports.generateLoginUrl = function(mail) {
	return env.auth0_login_url;
};

module.exports.generateHeaders = function(hasAuth, message) {
	var from = message.from;
	var to = message.to;
	var replyTo = generateReplyTo(hasAuth, from, to);
	if (from) {
		message.from = '"' + (message.formattedPhone || from) + '" <' + identity.id + '>';
	} else {
		message.from = identity.id;
	}
	if (message.email) {
		message.to = message.email;
	}
	message.replyTo = replyTo;
	return message;
};

module.exports.sendGmail = function(email) {
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
		return promise.denodeify(mailer.sendMail.bind(mailer))(email);
	});
};

var renewSubscriptionIfNecessary = function(data) {
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

var emailToSms = function(messages) {
	return promise.resolve(messages)
	.then(function(messages) {
		return messages.sort(function(a, b) {
			return a.time - b.time;
		});
	})
	.then(function(messages) {
		logger.debug('received emails', messages);
		return promise.all(messages.map(function(message) {
			logger.debug('parsing email', message);
			var from = parseEmailFromHeader(message.from);
			return auth.getOrCreateUser(from)
			.then(function(user) {
				if (auth.hasTwilioAuth(user)) {
					var phones = parsePhoneNumbersFromEmail(message.to);
					var body = parseBodyFromThread(message.body);
					if (phones && phones.length == 2 && body) {
						var txt = {
							from: phones[0],
							to: phones[1],
							body: body,
							twilioAccountSid: user.app_metadata.twilio_account_sid,
							twilioAuthToken: user.app_metadata.twilio_auth_token,
						};
						logger.debug('sending sms for user', user);
						return sms.sendSms(txt);
					} else {
						logger.error('unable to convert to sms', message);
					}
				} else {
					logger.warn('not sending sms for user with no twilio credentials', user);
				}
				return promise.resolve();
			});
		}));
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

