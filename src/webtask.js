'use strict';
var wt = require('webtask-tools');
var server = require('./twilio-voice');
var webtask = wt.fromExpress(server.app);

var auth = {
	authorized: [ 'splay.corp@gmail.com' ],
	exclude: [ '/sms', '/voice' ],
	scope: 'app_metadata',
};

module.exports = webtask; //.auth0(auth);

