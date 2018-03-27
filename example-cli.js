var Multihyperdb = require('.')
var hyperdiscovery = require('hyperdiscovery')

var db = process.argv[2]
var op = process.argv[3]

if (!op) op = 'list'

var ops = {
  create: create(),
  add: add(),
  read: read(),
  write: write(),
  share: share(),
  list: list()
}

if (!db || Object.keys(ops).indexOf(op) === -1) {
  console.log('usage: node example.js {db} [create|add|read|share] {name}')
  process.exit(1)
}

var dataOpts = {
  valueEncoding: 'json',
  reduce: function (a, b) { return a }
}

var opts = {
  path: './' + db,
  dataOpts: dataOpts
}

var multi = Multihyperdb(opts)

multi.ready(function () {
  ops[op](process.argv[4], process.argv[5], process.argv[6])
})

function list () {
  return function () {
    multi.each(function (db, key, meta) {
      console.log('DB ' + meta.name + ' ' + key)
    })
  }
}

function create () {
  return function (name) {
    if (!name) return console.log('Set name as argument.')
    multi.createDB(dataOpts, {name: name}, function (err, db, meta) {
      if (err) return err
      console.log('db created with key: ' + meta.key)
    })
  }
}

function write () {
  return function (name, key, value) {
    if (!name || !key || !value) return console.log('Set name key value as arguments.')
    console.log('ready!')
    var db = multi.getDBbyName(name).db
    console.log('got db', db.key.toString('hex'))
    db.put(key, value, function (err, node) {
      if (err) return console.log('Error', err)
      console.log('Wrote node: ', node)
    })
  }
}

function read () {
  return function (name) {
    if (!name) return console.log('Set name as argument.')
    console.log('ready!')
    var db = multi.getDBbyName(name).db
    console.log('got db', db.key.toString('hex'))
    var stream = db.createReadStream()
    stream.on('data', function (nodes) {
      console.log(nodes)
    })
  }
}

function add () {
  return function (name, key) {
    if (!name || !key) return console.log('Set name key as arguments.')
    multi.addDB(key, {}, {name: name}, function (err) {
      if (err) return console.log('Error', err)
      console.log('Added db ' + key)
    })
  }
}

function share () {
  return function () {
    multi.each(function (db) {
      var swarm = hyperdiscovery(db, {live: true})
      swarm.on('peer', function (peer) {
        console.log('GOT PEER', peer)
      })
    })
  }
}
