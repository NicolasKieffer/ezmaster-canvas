'use strict';

/* Dependencies */
const child_process = require('child_process'),
  fs = require('fs'),
  path = require('path'),
  nunjucks = require('nunjucks'),
  express = require('express'),
  bodyParser = require('body-parser'),
  kuler = require('kuler');

/* Server */
var app = express(),
  server = require('http').Server(app),
  io = require('socket.io')(server);

/* Constants */
// EzMaster config file
var CONFIG = require('/etc/ezmaster.json');

// Directories
const DIRECTORIES = {
  'INPUT': path.resolve(__dirname, CONFIG.dataPath),
  'OUTPUT': path.resolve(__dirname, CONFIG.outputPath),
  'PROGRAM': path.resolve(__dirname, '../', CONFIG.program.directory)
};

/* Variables */
var program = { // Program infos, statements and child_process will be there
    running: false,
    cmd: 'ls',
    opts: ['-alF'],
    messages: []
  },
  // List of all app clients
  clients = {};

program.cmd = CONFIG.program.cmd ||  program.cmd;
program.opts = CONFIG.program.opts ||  program.opts;

// App use Nunjucks template engine
nunjucks.configure('views', {
  autoescape: true,
  express: app
});

// App can parse JSON
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
  extended: true
}));

// Give public access for in/out directories
app.use('/input', express.static(DIRECTORIES.INPUT, {
  dotfiles: 'allow'
}));
app.use('/output', express.static(DIRECTORIES.OUTPUT, {
  dotfiles: 'allow'
}));
app.use(express.static('public'));

// Listening port 3000
server.listen(CONFIG.httpPort, function() {
  console.log(kuler('Server listening on port : ' + CONFIG.httpPort, 'green'));
});

io.on('connection', function(socket) {

  // Disconnect handler
  socket.on('disconnect', function() {
    console.log(kuler('Client disconnected', 'green'));
  });

  // Start Process
  socket.on('program', function() {
    if (program.child_process) {
      program.child_process.kill();
      delete program.child_process;
      program.messages = [];
      program.running = false;
      // Update button action
      io.emit('updateButton', program.running);
    } else {
      program.child_process = child_process.spawn(program.cmd, program.opts, {
        cwd: DIRECTORIES.PROGRAM
      });
      program.running = true;
      // Update button action
      io.emit('updateButton', program.running);
      /* -------------------- Event Handlers ---------- */
      // Send stdout to GUI
      program.child_process.stdout.on('data', function(data) {
        var messages = [{
          color: 'lightgreen',
          text: data.toString()
        }];
        io.emit('messages', messages);
        program.messages.push(messages[0]);
      });
      // Send stderr to GUI
      program.child_process.stderr.on('data', function(data) {
        var messages = [{
          color: 'orange',
          text: data.toString()
        }];
        io.emit('messages', messages);
        program.messages.push(messages[0]);
      });
      // Send shell errors to GUI
      program.child_process.on('error', function(data) {
        var messages = [{
          color: 'red',
          text: data.toString()
        }];
        io.emit('messages', messages);
        program.messages.push(messages[0]);
        program.running = false;
        // Update button action
        io.emit('updateButton', program.running);
      });
      // Refresh view of output directory
      program.child_process.on('close', function(code) {
        delete program.child_process;
        program.running = false;
        // Update button action
        io.emit('updateButton', program.running);
        var messages = [{
          color: 'gold',
          text: 'Process stopped with code ' + code
        }];
        io.emit('messages', messages);
        program.messages.push(messages[0]);
        fs.readdir(DIRECTORIES.OUTPUT, function(err, files) {
          if (err) throw new Error(kuler(err, 'red'));
          io.emit('updateView', {
            directory: 'output',
            files: getFiles(files)
          });
        });
      });
    }
  });
});

// Homepage
app.get('/', function(req, res) {
  let view = {
    'input': false,
    'ouput': false,
    'status': false,
    'pid': null
  };
  // Refresh file list of input directory
  fs.readdir(DIRECTORIES.INPUT, function(err, files) {
    io.emit('updateView', {
      directory: 'input',
      files: getFiles(files)
    });
  });
  // Refresh file list of output directory
  fs.readdir(DIRECTORIES.OUTPUT, function(err, files) {
    io.emit('updateView', {
      directory: 'output',
      files: getFiles(files)
    });
  });
  //Send data to view
  view.status = program.running;
  view.name = CONFIG.name;
  res.render('index.html', view);
});

/**
 * Get files infos (without hidden)
 * @param {Array} files List of files => [name, name, ...]
 * @return {Array} List of files with more infos (like name & full path) => [{name, path}, ...]
 */
function getFiles(files){
  var result = [];
  for (var i = 0; i < files.length; i++) {
    if(files[i][0] !== '.') {
      result.push({
        name: files[i],
        path: path.join(DIRECTORIES.OUTPUT, files[i])
      })
    }
  }
  return result;
}