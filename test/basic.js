var multi = require('..')
var ram = require('random-access-memory')
var tape = require('tape')
var reduce = (a, b) => a

var simpleStorage = function (master, key, destroy, cb) {
  if (destroy) return cb(null)
  return ram
}

var createTwo = function (t, M, dbOpts, cb) {
  M.createDB(dbOpts, {name: 'first'}, function (err, db) {
    t.error(err, 'no error')
    M.createDB(dbOpts, {name: 'second'}, function (err, db) {
      t.error(err, 'no error')
      db.ready(function () {
        cb()
      })
    })
  })
}

tape('basic ops', function (t) {
  var opts = {
    storage: simpleStorage
  }
  var dbOpts = { valueEncoding: 'utf8', reduce: reduce }

  var M = multi(opts)
  createTwo(t, M, dbOpts, function () {
    var first = M.getDBbyProp('name', 'first', true).db
    var second = M.getDBbyProp('name', 'second', true).db
    first.put('hello', 'world', function (err, node) {
      t.error(err, 'no error')
      second.put('hello', 'moon', function (err) {
        t.error(err, 'no error')
        first.get('hello', function (err, node) {
          t.error(err, 'no error')
          t.same(node.value, 'world', 'First db value matches')
          second.get('hello', function (err, node) {
            t.error(err, 'no error')
            t.same(node.value, 'moon', 'Second db value matches')
            t.end()
          })
        })
      })
    })
  })
})

tape('reopen', function (t) {
  var ramStore = {}
  var storage = function (master, key, destroy, cb) {
    var prefix = master ? 'master' : key
    if (!destroy) {
      return function (filename) {
        var path = prefix + '/' + filename
        if (!ramStore[path]) ramStore[path] = ram(path)
        return ramStore[path]
      }
    }
    if (destroy) {
      cb()
    }
  }

  var opts = {
    storage: storage,
    dbOpts: { reduce: reduce }
  }
  var dbOpts = { valueEncoding: 'utf8' }

  var M = multi(opts)
  var keys = {}

  M.createDB(dbOpts, {name: 'first'}, function (err, db) {
    t.error(err, 'no error')
    M.createDB(dbOpts, {name: 'second'}, function (err, db) {
      t.error(err, 'no error')
      db.ready(function () {
        M.each(function (db, key, meta) {
          db.put('mykey', key, function (err, node) {
            t.error(err, 'no error')
            keys[meta.name] = key
            if (Object.keys(keys).length === 2) didCreate()
          })
        })
      })
    })
  })
  function didCreate () {
    var M2 = multi(opts)
    M2.ready(function () {
      M2.getDBbyProp('name', 'first', true).db.get('mykey', function (err, node) {
        t.error(err, 'no error')
        t.same(node.value, keys.first, 'First key matches')
      })
      M2.getDBbyProp('name', 'second', true).db.get('mykey', function (err, node) {
        t.error(err, 'no error')
        t.same(node.value, keys.second, 'Second key matches')
        t.end()
      })
    })
  }
})

tape('combined read stream', function (t) {
  var opts = {
    storage: simpleStorage
  }
  var dbOpts = {valueEncoding: 'utf8', reduce: reduce}

  var M = multi(opts)
  createTwo(t, M, dbOpts, function () {
    var first = M.getDBbyProp('name', 'first', true).db
    var second = M.getDBbyProp('name', 'second', true).db

    var expected = []
    expected.push({key: first.key.toString('hex'), value: 'world'})
    expected.push({key: second.key.toString('hex'), value: 'moon'})

    first.put('hello', 'world', function (err, node) {
      t.error(err, 'no error')
      second.put('hello', 'moon', function (err) {
        t.error(err, 'no error')
        var stream = M.createReadStream()
        var i = 0
        stream.on('data', function (node) {
          i++
          var want = expected.filter(function (val) { return val.key === node.dbKey })[0]
          t.same(want.value, node.node.value, 'Got correct value from createReadStream')
          if (i === 2) {
            t.end()
          }
        })
      })
    })
  })
})
