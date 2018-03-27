var hyperdb = require('hyperdb')
var crypto = require('hypercore/lib/crypto.js')
var rimraf = require('rimraf')
var stream = require('readable-stream')
var multistream = require('multistream')
var thunky = require('thunky')

var util = require('util')
var fs = require('fs')
var events = require('events')

var Transform = stream.Transform

module.exports = MultiHyperDB

function MultiHyperDB (opts) {
  if (!(this instanceof MultiHyperDB)) return new MultiHyperDB(opts)
  opts = opts || {}

  this.path = opts.path || './db'
  this.masterPath = opts.masterPath || this.path + '/master'
  this.dbPath = opts.dbPath || this.path + '/data'
  this.dbOpts = opts.dbOpts || {}
  this.storage = opts.storage || this._fileStorage.bind(this)

  this._prefix = '@dbs/'
  this.dbs = {}
  this.opened = false

  this.ready = thunky(this._ready.bind(this))

  this.master = hyperdb(this.storage(true), {
    valueEncoding: 'json',
    reduce: reduce
  })

  this.ready()
}

util.inherits(MultiHyperDB, events.EventEmitter)

MultiHyperDB.prototype._ready = function (cb) {
  var self = this
  var progress = {errs: [], count: 0, loaded: 0, checked: 0, recheck: null}

  this.master.ready(function (err) {
    if (err) done(err)
    var stream = self.master.createReadStream(this._prefix)
    stream.on('data', load)
    stream.on('end', check)
  })

  function load (node) {
    progress.count++
    if (Array.isArray(node) && node.length) node = node[0]
    if (node) self._loadDB(node.value, loaded)
  }

  function loaded (err, db) {
    if (err) progress.errs.push(err)
    else progress.loaded++
  }

  function check () {
    progress.checked++
    if (progress.count === progress.loaded) {
      done(null)
    } else if (progress.errs.length + progress.loaded === progress.count) {
      var msg = 'Errors: ' + progress.errs.map(function (err) { return err.message }).join(' | ')
      done(new Error('Could not init all databases. ' + msg))
    } else if (progress.checked >= 10) {
      done(new Error('Cound not init all databases: Timeout.'))
    } else if (progress.checked === 1) {
      progress.recheck = setInterval(check, 100)
    }
  }

  function done (err) {
    if (progress.recheck) clearInterval(progress.recheck)
    if (err) return cb(err)
    self.opened = true
    self.emit('ready')
    cb(null)
  }
}

MultiHyperDB.prototype.each = function (cb) {
  var self = this
  this.ready(function () {
    Object.keys(self.dbs).forEach(function (key) {
      cb(self.dbs[key].db, key, self.dbs[key].meta)
    })
  })
}

MultiHyperDB.prototype.createReadStream = function (prefix) {
  var self = this

  var streams = Object.keys(this.dbs).map(function (key) {
    return function () {
      var transform = new Transform({objectMode: true})
      transform._transform = function (nodes, enc, next) {
        function transform (node) {
          return {node: node, dbKey: key}
        }
        if (Array.isArray(nodes)) this.push(nodes.map(transform))
        else this.push(transform(nodes))
        next()
      }
      return self.dbs[key].db.createReadStream(prefix).pipe(transform)
    }
  })

  return multistream.obj(streams)
}

MultiHyperDB.prototype.createDB = function (opts, meta, cb) {
  if (typeof meta === 'function') return this.createDB(opts, null, meta)
  var self = this
  opts = Object.assign({}, this.dbOpts, opts)

  var keyPair = crypto.keyPair()
  opts.secretKey = keyPair.secretKey
  opts.storeSecretKey = true

  var db = hyperdb(this.storage(false, keyPair.publicKey.toString('hex')), keyPair.publicKey, opts)

  db.on('ready', function () {
    self._putDB(db, opts, meta, cb)
  })
}

MultiHyperDB.prototype.addDB = function (key, opts, meta, cb) {
  if (typeof meta === 'function') return this.addDB(key, opts, null, meta)
  if (key instanceof Buffer) key = key.toString('hex')
  var self = this
  opts = Object.assign({}, this.dbOpts, opts)

  if (this.dbs[key]) {
    return cb(null, this.dbs[key])
  }

  var db = hyperdb(this.storage(false, key), key, opts)
  db.ready(function () {
    self._putDB(db, opts, meta, cb)
  })
}

MultiHyperDB.prototype.dropDB = function (key, opts, cb) {
  if (key instanceof Buffer) key = key.toString('hex')
  var self = this
  if (!this.dbs[key]) {
    return done(new Error('Database ' + key + ' does not exist.'))
  }
  this.master.del(this._keyToPrefix(key), function (err) {
    if (err) return cb(err)
    if (opts.destroy) {
      this.storage(false, key, true, cb)
    } else done()
  })

  function done (err) {
    if (err) return cb(err)
    delete self.dbs[key]
    cb(null)
  }
}

MultiHyperDB.prototype.getDB = function (key) {
  if (key instanceof Buffer) key = key.toString('hex')
  return this.dbs[key] ? this.dbs[key] : null
}

MultiHyperDB.prototype.getDBbyProp = function (prop, value, single) {
  var self = this
  var keys = Object.keys(this.dbs).filter(function (key) {
    return self.dbs[key].meta && self.dbs[key].meta[prop] === value
  })
  if (single && keys.length) return this.dbs[keys[0]]
  else if (keys.length) return keys.map(function (key) { return self.dbs[key] })
  else return null
}

MultiHyperDB.prototype.getDBbyName = function (name) {
  return this.getDBbyProp('name', name, true)
}

MultiHyperDB.prototype.getDBs = function () {
  return this.dbs
}

MultiHyperDB.prototype.replicate = function () {
  this.each(function (db) {
    db.replicate()
  })
}

MultiHyperDB.prototype._loadDB = function (value, cb) {
  if (this.dbs[value.key]) {
    cb(null, this.dbs[value.key])
  }
  var opts = Object.assign({}, this.dbOpts, value.opts)
  var db = hyperdb(this.storage(false, value.key), value.key, opts)
  return this._setDB(db, value, cb)
}

MultiHyperDB.prototype._setDB = function (db, value, cb) {
  this.dbs[value.key] = value
  this.dbs[value.key].db = db
  if (cb) db.ready(function (err) { cb(err, db, value) })
}

MultiHyperDB.prototype._putDB = function (db, opts, meta, cb) {
  var self = this
  var value = {
    opts: opts || {},
    meta: meta || {},
    key: db.key.toString('hex')
  }
  Object.keys(value.opts).forEach(function (key) {
    if (typeof value.opts[key] === 'function') {
      delete value.opts[key]
    } else if (key === 'secretKey') {
      delete value.opts[key] // todo: maybe store secret key here too?
    }
  })
  this.master.put(this._keyToPrefix(db.key), value, function (err) {
    if (cb && err) cb(err)
    self._setDB(db, value, cb)
  })
}

MultiHyperDB.prototype._keyToPath = function (key) {
  if (key instanceof Buffer) key = key.toString('hex')
  return this.dbPath + '/' + key.slice(0, 2) + '/' + key.slice(2)
}

MultiHyperDB.prototype._keyToPrefix = function (key) {
  if (key instanceof Buffer) key = key.toString('hex')
  return this._prefix + key
}

MultiHyperDB.prototype._fileStorage = function (master, key, destroy, cb) {
  if (master) {
    return this.masterPath
  } else if (!destroy) {
    return this._keyToPath(key)
  } else {
    var path = this._keyToPath(key)
    if (fs.existsSync(path) && (fs.existsSync(path.join(path, 'source')) || fs.existsSync(path.join(path, 'local')))) {
      rimraf(path, {disableGlob: true}, cb)
    } else {
      cb(new Error('Database does not exist.'))
    }
  }
}

function reduce (a, b) {
  return a
}
