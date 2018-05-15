'use strict';
var env = require('./env');
var promise = require('promise');
var winston = require('winston');
var sentry = require('./winston-sentry');
var logger = new winston.Logger({
	//level: 'debug',
	level: 'info',
	transports: [
		new winston.transports.Console(),
		new sentry({
			level: 'verbose',
			dsn: env.sentry_url,
		})
	],
});
module.exports.logger = logger;

module.exports.logError = function(err) {
	if (err) logger.error('caught error:', err);
	return promise.reject(err);
};

module.exports.stringify = function(obj) {
	var cache = [];
	var json = JSON.stringify(obj, function(key, value) {
		if (typeof value === 'object' && value !== null) {
			if (cache.indexOf(value) !== -1) { return; }
			cache.push(value);
		}
		return value;
	});
	cache = null;
	return json;
};

module.exports.stringArray = function(strs) {
	if (strs instanceof Array) {
		return strs;
	} else if (typeof strs === 'string') {
		return [strs];
	} else {
		return [];
	}
};

module.exports.filterNulls = function(arr) {
	return arr.filter(function(el) { return el; });
};

