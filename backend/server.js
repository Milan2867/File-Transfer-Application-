const express = require('express');
const http = require('http');
const cors = require('cors');
const mongoose = require('mongoose');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');

const authRoutes = require('./routes/auth');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use('/api/auth', authRoutes);

mongoose.connect('mongodb://localhost:27017/filetransfer', { useNewUrlParser: true, useUnifiedTopology: true });

let onlineUsers = {};

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication error'));
  jwt.verify(token, 'SECRET', (err, user) => {
    if (err) return next(new Error('Authentication error'));
    socket.user = user;
    next();
  });
});

io.on('connection', (socket) => {
  onlineUsers[socket.user.username] = socket.id;
  io.emit('onlineUsers', Object.keys(onlineUsers));

  socket.on('sendFile', ({ to, fileName, fileBuffer }) => {
    const recipientSocketId = onlineUsers[to];
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('receiveFile', {
        from: socket.user.username,
        fileName,
        fileBuffer
      });
    }
  });

  socket.on('disconnect', () => {
    delete onlineUsers[socket.user.username];
    io.emit('onlineUsers', Object.keys(onlineUsers));
  });
});

server.listen(5000, () => console.log('Server running on port 5000'));
