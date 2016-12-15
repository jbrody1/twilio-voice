'use strict';
var utils = require('./utils');
var logger = utils.logger;
logger.transports.console.level = 'debug';
var server = require('./twilio-voice');

server.app.listen(4000);

