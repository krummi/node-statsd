var dgram = require('dgram');
var dns = require('dns');
var onHeaders = require('on-headers');
var util = require('util');

/**
 * The UDP Client for StatsD
 * @param options
 *   @option host      {String}  The host to connect to default: localhost
 *   @option port      {String|Integer} The port to connect to default: 8125
 *   @option prefix    {String}  An optional prefix to assign to each stat name sent
 *   @option suffix    {String}  An optional suffix to assign to each stat name sent
 *   @option globalize {boolean} An optional boolean to add "statsd" as an object in the global namespace
 *   @option cacheDns  {boolean} An optional option to only lookup the hostname -> ip address once
 *   @option mock      {boolean} An optional boolean indicating this Client is a mock object, no stats are sent.
 * @constructor
 */
var Client = function (host, port, prefix, suffix, globalize, cacheDns, mock) {
  var options = host || {},
         self = this;

  if(arguments.length > 1 || typeof(host) === 'string'){
    options = {
      host      : host,
      port      : port,
      prefix    : prefix,
      suffix    : suffix,
      globalize : globalize,
      cacheDns  : cacheDns,
      mock      : mock === true
    };
  }

  this.host   = options.host || 'localhost';
  this.port   = options.port || 8125;
  this.prefix = options.prefix || '';
  this.suffix = options.suffix || '';
  this.socket = dgram.createSocket('udp4');
  this.mock   = options.mock;

  if(options.cacheDns === true){
    dns.lookup(options.host, function(err, address, family){
      if(err == null){
        self.host = address;
      }
    });
  }

  if(options.globalize){
    global.statsd = this;
  }
};

/**
 * Represents the timing stat
 * @param stat {String|Array} The stat(s) to send
 * @param time {Number} The time in milliseconds to send
 * @param sampleRate {Number=} The Number of times to sample (0 to 1). Optional.
 * @param tags {Array=} The Array of tags to add to metrics. Optional.
 * @param callback {Function=} Callback when message is done being delivered. Optional.
 */
Client.prototype.timing = function (stat, time, sampleRate, tags, callback) {
  this.sendAll(stat, time, 'ms', sampleRate, tags, callback);
};

/**
 * Increments a stat by a specified amount
 * @param stat {String|Array} The stat(s) to send
 * @param value The value to send
 * @param sampleRate {Number=} The Number of times to sample (0 to 1). Optional.
 * @param tags {Array=} The Array of tags to add to metrics. Optional.
 * @param callback {Function=} Callback when message is done being delivered. Optional.
 */
Client.prototype.increment = function (stat, value, sampleRate, tags, callback) {
  this.sendAll(stat, value || 1, 'c', sampleRate, tags, callback);
};

/**
 * Decrements a stat by a specified amount
 * @param stat {String|Array} The stat(s) to send
 * @param value The value to send
 * @param sampleRate {Number=} The Number of times to sample (0 to 1). Optional.
 * @param tags {Array=} The Array of tags to add to metrics. Optional.
 * @param callback {Function=} Callback when message is done being delivered. Optional.
 */
Client.prototype.decrement = function (stat, value, sampleRate, tags, callback) {
  this.sendAll(stat, -value || -1, 'c', sampleRate, tags, callback);
};

/**
 * Represents the histogram stat
 * @param stat {String|Array} The stat(s) to send
 * @param value The value to send
 * @param sampleRate {Number=} The Number of times to sample (0 to 1). Optional.
 * @param tags {Array=} The Array of tags to add to metrics. Optional.
 * @param callback {Function=} Callback when message is done being delivered. Optional.
 */
Client.prototype.histogram = function (stat, value, sampleRate, tags, callback) {
  this.sendAll(stat, value, 'h', sampleRate, tags, callback);
};


/**
 * Gauges a stat by a specified amount
 * @param stat {String|Array} The stat(s) to send
 * @param value The value to send
 * @param sampleRate {Number=} The Number of times to sample (0 to 1). Optional.
 * @param tags {Array=} The Array of tags to add to metrics. Optional.
 * @param callback {Function=} Callback when message is done being delivered. Optional.
 */
Client.prototype.gauge = function (stat, value, sampleRate, tags, callback) {
  this.sendAll(stat, value, 'g', sampleRate, tags, callback);
};

/**
 * Counts unique values by a specified amount
 * @param stat {String|Array} The stat(s) to send
 * @param value The value to send
 * @param sampleRate {Number=} The Number of times to sample (0 to 1). Optional.
 * @param tags {Array=} The Array of tags to add to metrics. Optional.
 * @param callback {Function=} Callback when message is done being delivered. Optional.
 */
Client.prototype.unique =
Client.prototype.set = function (stat, value, sampleRate, tags, callback) {
  this.sendAll(stat, value, 's', sampleRate, tags, callback);
};

/**
 * Checks if stats is an array and sends all stats calling back once all have sent
 * @param stat {String|Array} The stat(s) to send
 * @param value The value to send
 * @param sampleRate {Number=} The Number of times to sample (0 to 1). Optional.
 * @param tags {Array=} The Array of tags to add to metrics. Optional.
 * @param callback {Function=} Callback when message is done being delivered. Optional.
 */
Client.prototype.sendAll = function(stat, value, type, sampleRate, tags, callback){
  var completed = 0,
      calledback = false,
      sentBytes = 0,
      self = this;

  if(sampleRate && typeof sampleRate !== 'number'){
    callback = tags;
    tags = sampleRate;
    sampleRate = undefined;
  }

  if(tags && !Array.isArray(tags)){
    callback = tags;
    tags = undefined;
  }

  /**
   * Gets called once for each callback, when all callbacks return we will
   * call back from the function
   * @private
   */
  function onSend(error, bytes){
    completed += 1;
    if(calledback || typeof callback !== 'function'){
      return;
    }

    if(error){
      calledback = true;
      return callback(error);
    }

    sentBytes += bytes;
    if(completed === stat.length){
      callback(null, sentBytes);
    }
  }

  if(Array.isArray(stat)){
    stat.forEach(function(item){
      self.send(item, value, type, sampleRate, tags, onSend);
    });
  } else {
    this.send(stat, value, type, sampleRate, tags, callback);
  }
};

/**
 * Sends a stat across the wire
 * @param stat {String|Array} The stat(s) to send
 * @param value The value to send
 * @param type {String} The type of message to send to statsd
 * @param sampleRate {Number} The Number of times to sample (0 to 1)
 * @param tags {Array} The Array of tags to add to metrics
 * @param callback {Function=} Callback when message is done being delivered. Optional.
 */
Client.prototype.send = function (stat, value, type, sampleRate, tags, callback) {
  var message = this.prefix + stat + this.suffix + ':' + value + '|' + type,
      buf;

  if(sampleRate && sampleRate < 1){
    if(Math.random() < sampleRate){
      message += '|@' + sampleRate;
    } else {
      //don't want to send if we don't meet the sample ratio
      return;
    }
  }

  if(tags && Array.isArray(tags)){
    message += '|#' + tags.join(',');
  }

  // Only send this stat if we're not a mock Client.
  if(!this.mock) {
    buf = new Buffer(message);
    this.socket.send(buf, 0, buf.length, this.port, this.host, callback);
  } else {
    if(typeof callback === 'function'){
      callback(null, 0);
    }
  }
};

/**
 * Close the underlying socket and stop listening for data on it.
 */
Client.prototype.close = function(){
    this.socket.close();
};

/**
 * An connect middleware that sends metrics on the route timings to statsd.
 * @param key the statsd key to use.
 * @returns {measure} the middleware.
 */
Client.prototype.measureRoute = function (key) {

  function toMillis(hrtime) {
    var ms = hrtime[0] * 1e3 + hrtime[1] * 1e-6;
    return ms.toFixed(0);
  }

  var that = this;

  return function measure(req, res, next) {
    var route = req.route.path.replace(/\:/g, '*');

    onHeaders(res, function () {
      var tags;
      for (var i = 1; i < req.measurements.length; i++) {
        //console.log(util.format('%s: %d ms <tags=route:%s,part:%s>.',
        //  key, req.measurements[i].diff, route, req.measurements[i].key));

        tags = ['route:' + route, 'part:' + req.measurements[i].key];
        that.histogram(key, req.measurements[i].diff, tags);
      }

      var totalDiff = toMillis(process.hrtime(req.measurements[0].time));
      // console.log(util.format('%s: %d ms <tags=route:%s>.', key, totalDiff, route));

      tags = ['route:' + route];

      // TODO: Fix this hack.
      that.histogram(key + '.total', totalDiff, tags);
    });

    req.measurements = [
      {
        key: 'initial',
        time: process.hrtime(),
        diff: 0
      }
    ];
    req.time = function (key) {
      var last = this.measurements.slice(-1)[0];
      var diff = toMillis(process.hrtime(last.time));
      this.measurements.push({
        key: key,
        time: process.hrtime(),
        diff: diff
      });
    };

    next();

  };
};

exports = module.exports = Client;
exports.StatsD = Client;
