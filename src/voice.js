'use strict';
var env = require('./env');
var views = require('./views');
var utils = require('./utils');
var logger = utils.logger;
var auth = require('./auth');
var email = require('./email');
var twilio = require('twilio');
var watson = require('watson-developer-cloud');
var request = require('request');
var pug = require('pug');
var promise = require('promise');
var streamToPromise = require('stream-to-promise');

var speechToText = watson.speech_to_text({
	url: 'https://stream.watsonplatform.net/speech-to-text/api',
	version: 'v1',
	username: env.watson_stt_username,
	password: env.watson_stt_password,
});

var tryFormat = function(twilioClient, phoneNumber) {
	var lookup = new twilio.LookupsClient(twilioClient.accountSid, twilioClient.authToken);
	return promise.denodeify(lookup.phoneNumbers(phoneNumber).get)()
	.then(function(result) {
		logger.debug('lookup for phone number ' + phoneNumber, result);
		return result.national_format || phoneNumber;
	})
	.catch(function(err) {
		logger.warn('failed to lookup phone number', err);
		return phoneNumber
	});
};
module.exports.tryFormat = tryFormat;

var transcribe = function(url) {
	var transcript = speechToText.createRecognizeStream({
		content_type: 'audio/wav',
		model: 'en-US_NarrowbandModel',
		smart_formatting: true,
	});
	transcript.setEncoding('utf8');
	request(url).pipe(transcript);
	return streamToPromise(transcript)
	.then(function(buf) {
		return buf.toString('utf8');
	})
	.then(function(str) {
		return str ? str.replace(/%HESITATION/g, '...') : str;
	})
	.catch(function(err) {
		logger.error('watson transcription failed', err);
	});
};
module.exports.transcribe = transcribe;

var parseSipEndpoint = function(endpoint) {
	var startPos = (endpoint && (endpoint.indexOf('sip:') === 0 || endpoint.indexOf('sips:') === 0)) ? endpoint.indexOf(':') + 1 : -1;
	var endPos = endpoint.indexOf('@');
	var phoneNumber = (startPos > 0 && endPos > 0) ? endpoint.substring(startPos, endPos) : null;
	return phoneNumber;
};

module.exports.handleVoice = function(req, res) {
	var phoneNumbers = utils.stringArray(req.params.phone);
	var twiml = new twilio.TwimlResponse();
	if (req.params.Direction === 'inbound') {
		twiml.dial({
			callerId: req.params.From,
			action: env.webtask_container + '/twilio-voice/voicemail?email=' + encodeURIComponent(req.params.email),
			timeout: 18,
		}, function(dial) {
			for (var i=0; i<phoneNumbers.length; i++) {
				dial.number(phoneNumbers[i]);
			}
		});
	} else {
		logger.warn('invalid call direction', req.params.Direction);
	}
	res.writeHead(200, { 'Content-Type': 'text/xml' });
	res.write(twiml.toString());
};

var echo = function(twiml) {
	return 'https://twimlets.com/echo?Twiml=' + encodeURIComponent(twiml.toString());
};

module.exports.handleVoicemail = function(req, res) {
	var twiml = new twilio.TwimlResponse();
	if (req.params.Direction === 'inbound' && req.params.DialCallStatus === 'no-answer') {
		var record = {
			action: echo(new twilio.TwimlResponse().hangup()),
			maxLength: 60,
			transcribe: true,
			transcribeCallback: env.webtask_container + '/twilio-voice/voicemail?email=' + encodeURIComponent(req.params.email),
			//recordingStatusCallback: env.webtask_container + '/twilio-voice/voicemail?email=' + encodeURIComponent(req.params.email),
		};
		twiml.gather({
			numDigits: 1,
			timeout: 0,
			action: echo(new twilio.TwimlResponse().record(record)),
		}, function(gather) {
			//gather.say({ voice: 'alice'}, 'Please leave a message')
			gather.play({}, 'https://s3-us-west-1.amazonaws.com/jbrody-public/audio/voicemail-python.mp3')
		})
		.record(record);
	} else if (req.params.RecordingStatus === 'completed' || req.params.TranscriptionStatus === 'completed') {
		auth.getOrCreateUser(req.params.email)
		.then(function(user) {
			// watson transcription
			return transcribe(req.params.RecordingUrl)
			.then(function(watson) {
				var hasAuth = auth.hasTwilioAuth(user);
				var p = promise.resolve(req.params.From);
				if (hasAuth) {
					var client = new twilio.RestClient(user.app_metadata.twilio_account_sid, user.app_metadata.twilio_auth_token);
					p = tryFormat(client, req.params.From);
				}
				var transcription = req.params.TranscriptionText ? req.params.TranscriptionText.replace(/\n\n/g, '..') : '';
				logger.info('twilio', transcription);
				logger.info('watson', watson);
				return p
				.then(function(formattedPhone) {
					// email recording/transcription here
					var dialerUrl = email.generateDialerUrl(user.email, req.params.To, req.params.From);
					var loginUrl = email.generateLoginUrl(user.email);
					var params = {
						twilio: transcription,
						watson: watson,
						formattedPhone: formattedPhone,
						hasAuth: hasAuth,
						recordingUrl: req.params.RecordingUrl,
						dialerUrl: dialerUrl,
						loginUrl: loginUrl,
					};
					var message = email.generateHeaders(hasAuth, {
						from: req.params.From,
						to: req.params.To,
						email: user.email,
						formattedPhone: formattedPhone,
						subject: 'Voicemail from ' + formattedPhone,
						html: pug.render(views.voicemail, params),
						text: pug.render(views.voicemailPlain, params),
					});
					return message;
				})
				.then(email.sendGmail);
			});
		})
		.catch(function(err) {
			logger.error('failed to email voicemail', err);
		});
	}
	res.writeHead(200, { 'Content-Type': 'text/xml' });
	res.write(twiml.toString());
};

module.exports.handleSip = function(req, res) {
	var twiml = new twilio.TwimlResponse();
	if (req.params.Direction === 'inbound') {
		var from = parseSipEndpoint(req.params.From);
		var to = parseSipEndpoint(req.params.To);
		if (from && to) {
			twiml.dial(to, {
				callerId: from,
			});
		} else {
			logger.error('invalid endpoints: ' + req.params.From + ', ' + req.params.To);
		}
	} else {
		logger.warn('invalid call direction', req.params.Direction);
	}
	res.writeHead(200, { 'Content-Type': 'text/xml' });
	res.write(twiml.toString());
};

