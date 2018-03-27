# MultiHyperDB

Manage many [hyperdbs](https://github.com/mafintosh/hyperdb)s

## Installation

`npm install multihyperdb`

## Usage

```js

var multi = require('multihyperdb')

var opts = {
  path: './db',
  dataOpts: {valueEncoding: 'json'}
}

var Multi = multi(opts)

multi.createDB({}, {name: 'First database'}, function(err, db) {
  db.put('hello', 'world', function (err, node) { } )
})

```

## API

#### `var multi = multihyperdb(opts)`

Create a new MultiHyperDB. Stores info about multiple hyperdbs in a master hyperdb.

Options include:

```js
{
  path: './db' // Path to store the databases in
  masterPath, dataPath // Set basepath for master databases and child databases manually
  dataOpts // default hyperdb opts for child databases
  storage // callback to return a random-access-storage (see below)
}
```

#### `multi.createDB(opts, meta, cb)`

Create a new hyperdb. `opts` are regular hyperdb opts (they override the global `dataOpts`). `meta` may have any JSON to be stored in the master hyperdb for this child db. `cb` will be called with `(err, db)` after the database is ready.

#### `multi.addDB(key, opts, meta, cb)`

Add a hyperdb with key `key`. Other options as in `createDB`.

#### `multi.dropDB(key, opts, cb)`

Drop database `key` from being managed in this MultiHyperDB. Pass `{delete: true}` as opts to physically delete the database from disc.

#### `multi.each(callback)`

Execute a callback for each database. `callback`s parameters are `(db, key, meta)`.

#### `multi.createReadStream(prefix)`

Get a combined read stream on all child databases. The `on('data'` callback receives nodes with an additional `dbKey` property along hyperdb's regular `key` and `value` properties.

#### `multi.getDB(key)`

Get a database by key.

#### `multi.getDBbyProperty(prop, value, [single])`

Get a database by meta property. If `single` is true, only the first matching database is returned.

### Custom storage 

By default, both master and child dbs are created with random-access-file storage in the path(s) configured via opts. Alternatively, pass a function as `opts.storage`.

```js
opts.storage = function(master, key, destroy, cb) {
}
```
If `destroy` is false, return a random-access-storage for either master (if `master` is `true`) or the child database with key `key`. If destroy is `true`, destroy (delete) the child database with key `key` and call the callback `cb`.

### Syncing and sharing

... is as simple as

```js

var multi = require('multihyperdb')
var hyperdiscovery = require('hyperdiscovery')

var Multi = multi({path: './db1'})

// Create some databases or add existing keys.

// Two-way sync them all!
Multi.each(function(db) {
  hyperdiscovery(db, {live: true})
})
```

Try it out with example-cli.js:

```
$ node example-cli.js db1 create myfirstdb
db created with key: d7f69b22386fdc7751fb26e6a458a45c1a5d369525ac0e428eaf0331f59ff0e1

$ node example-cli.js db1 write myfirstdb hello world
Wrote node: Node(key=hello, value='world', seq=0, feed=0))

$ node example-cli.js db1 share


# In another terminal or on another computer

$ node example-cli.js db2 add remotedb d7f69b22386fdc7751fb26e6a458a45c1a5d369525ac0e428eaf0331f59ff0e1 
$ node example-cli.js db2 share

# wait, then abort

$ node example-cli.js db2 read
Node(key=hello, value='world', seq=0, feed=0))

# This was synced from db1.myfirstdb !

```
