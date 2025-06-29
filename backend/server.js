const express = require('express');
const http = require('http');
const cors = require('cors');
const mongoose = require('mongoose');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');

const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api', profileRoutes);

mongoose.connect('mongodb://localhost:27017/filetransfer', { useNewUrlParser: true, useUnifiedTopology: true });

let onlineUsers = {};
const fileChunks = {}; // { username_fileName: { chunks: [], totalChunks, ... } }

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

  // Chunked file transfer
  socket.on('sendFileChunk', ({ to, fileName, totalChunks, currentChunk, chunkBuffer, fileSize, type }) => {
    const key = `${socket.user.username}_${fileName}`;
    if (!fileChunks[key]) {
      fileChunks[key] = { chunks: [], totalChunks, fileName, fileSize, type, from: socket.user.username };
    }
    fileChunks[key].chunks[currentChunk] = Buffer.from(chunkBuffer);

    // If all chunks received, send to recipient
    if (fileChunks[key].chunks.filter(Boolean).length === totalChunks) {
      const allChunks = fileChunks[key].chunks;
      const fileBuffer = Buffer.concat(allChunks);
      const recipientSocketId = onlineUsers[to];
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('receiveFile', {
          from: fileChunks[key].from,
          fileName: fileChunks[key].fileName,
          fileBuffer,
          type: fileChunks[key].type,
        });
      }
      delete fileChunks[key];
    }
  });

  // Legacy single-chunk transfer for compatibility
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
