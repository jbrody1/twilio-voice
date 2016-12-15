'use strict';
var env = require('./env');
var views = require('./views');
var utils = require('./utils');
var logger = utils.logger;
var auth = require('./auth');
var email = require('./email');
var voice = require('./voice');
var twilio = require('twilio');
var promise = require('promise');
var pug = require('pug');

var twiml = function(req, res) {
	var phoneNumbers = utils.stringArray(req.params.phone);
	var twiml = new twilio.TwimlResponse();
	for (var i=0; i<phoneNumbers.length; i++) {
		twiml.message(req.params.From + ': ' + req.params.Body, {
			/* from: req.params.From */
			to: phoneNumbers[i]
		});
	}
	res.writeHead(200, { 'Content-Type': 'text/xml' });
	res.write(twiml.toString());
	return promise.resolve();
};

module.exports.handleSms = function(req, res) {
	if (req.params.email) {
		auth.getOrCreateUser(req.params.email, req.params.AccountSid)
		.then(function(user) {
			var hasAuth = auth.hasTwilioAuth(user);
			var p = promise.resolve(req.params.From);
			if (hasAuth) {
				var client = new twilio.RestClient(user.app_metadata.twilio_account_sid, user.app_metadata.twilio_auth_token);
				p = voice.tryFormat(client, req.params.From);
			}
			return p
			.then(function(formattedPhone) {
				var dialerUrl = email.generateDialerUrl(user.email, req.params.To, req.params.From);
				var loginUrl = email.generateLoginUrl(user.email);
				var params = {
					text: req.params.Body,
					formattedPhone: formattedPhone,
					hasAuth: hasAuth,
					dialerUrl: dialerUrl,
					loginUrl: loginUrl,
				};
				var message = email.generateHeaders(hasAuth, {
					from: req.params.From,
					to: req.params.To,
					email: user.email,
					formattedPhone: formattedPhone,
					subject: 'SMS from ' + formattedPhone,
					html: pug.render(views.sms, params),
					text: pug.render(views.smsPlain, params),
				});
				return message;
			})
			.then(email.sendGmail);
		})
		.catch(utils.logError);
	}
	return twiml(req, res);
};

module.exports.sendSms = function(sms) {
	if (sms.twilioAccountSid && sms.twilioAuthToken) {
		var client = new twilio.RestClient(sms.twilioAccountSid, sms.twilioAuthToken);
		var message = {
			from: sms.from,
			to: sms.to,
			body: sms.body
		};
		logger.info('sending sms', message);
		return promise.denodeify(client.sms.messages.create)(message);
 	} else {
		return promise.reject('no twilio credentials for user', sms);
	}
};

