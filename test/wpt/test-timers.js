'use strict';

const { WPTRunner } = require('../common/wpt');

const runner = new WPTRunner('html/webappapis/timers');

runner.runJsTests();
