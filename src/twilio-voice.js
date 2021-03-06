'use strict';
var utils = require('./utils');
var logger = utils.logger;
var sms = require('./sms');
var voice = require('./voice');
var dialer = require('./dialer');
var email = require('./email');
var promise = require('promise');
var extend = require('extend');

/* express stuff */
var express = require('express');
var bodyParser = require('body-parser');
var app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true })); 

var handle = function(path, handler) {
	var wrapper = function(req, res) {
		return promise.resolve()
		// normalize get/post parameters
		.then(function() {
			req.params = req.method === 'GET' ? req.query : extend(req.query, req.body);
			return handler(req, res);
		})
		// return success response
		.then(function() {
			logger.debug('request complete', res.headersSent);
			return res.end();
		})
		// return error response
		.catch(function(err) {
			logger.debug('request failed');
			if (!res.headersSent) res.status(500).send(err);
			return utils.logError(err);
		});
	};
	app.get(path, wrapper);
	app.post(path, wrapper);
}

handle('/voice', voice.handleVoice);
handle('/voicemail', voice.handleVoicemail);
handle('/sip', voice.handleSip);
handle('/sms', sms.handleSms);
handle('/email', email.handleEmail);
handle('/dialer', dialer.handleDialer);

module.exports.app = app;

