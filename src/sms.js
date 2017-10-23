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

module.exports.handleSms = function(req, res) {
	// handle an incoming sms and return twiml to forward it and send email
	if (req.params.email) {
		auth.getOrCreateUser(req.params.email, req.params.AccountSid)
		.then(function(user) {
			// format phone number
			return voice.tryFormat(user, req.params.From)
			// generate email
			.then(function(formattedPhone) {
				var hasAuth = auth.hasTwilioAuth(user);
				var dialerUrl = email.generateDialerUrl(user.email, req.params.To, req.params.From);
				var params = {
					text: req.params.Body,
					formattedPhone: formattedPhone,
					hasAuth: hasAuth,
					dialerUrl: dialerUrl,
				};
				return email.generateHeaders({
					from: req.params.From,
					to: req.params.To,
					email: user.email,
					hasAuth: hasAuth,
					formattedPhone: formattedPhone,
					subject: 'SMS from ' + formattedPhone,
					html: pug.render(views.sms, params),
					text: pug.render(views.smsPlain, params),
				});
			})
			// send email
			.then(email.sendGmail);
		})
		.catch(utils.logError);
	}
	return promise.resolve()
	// generate twiml response to forward sms to phone numbers specified in the request
	.then (function() {
		var phoneNumbers = utils.stringArray(req.params.phone);
		var twiml = new twilio.TwimlResponse();
		for (var i=0; i<phoneNumbers.length; i++) {
			twiml.message(req.params.From + ': ' + req.params.Body, {
				// Twilio does not allow true sms forwarding; submitted feature request
				/* from: req.params.From */
				to: phoneNumbers[i]
			});
		}
		res.writeHead(200, { 'Content-Type': 'text/xml' });
		res.write(twiml.toString());
	});
};

module.exports.sendSms = function(sms) {
	if (sms.twilioAccountSid && sms.twilioAuthToken) {
		// send sms
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

