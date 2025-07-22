require('dotenv').config();
const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const mongoose = require('mongoose');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');

const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');

const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
});
app.use('/api/', limiter);

// File upload rate limiting (more restrictive)
const fileUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 file uploads per windowMs
  message: 'Too many file uploads from this IP, please try again later.',
});

// CORS configuration
const corsOptions = {
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

app.use(express.json({ limit: '1mb' })); // Limit JSON payload size

// File validation middleware
const fileFilter = (req, file, cb) => {
  const allowedTypes = (process.env.ALLOWED_FILE_TYPES || '.jpg,.jpeg,.png,.gif,.pdf,.doc,.docx,.txt,.zip,.rar').split(',');
  const fileExtension = path.extname(file.originalname).toLowerCase();
  
  if (allowedTypes.includes(fileExtension)) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${fileExtension} is not allowed. Allowed types: ${allowedTypes.join(', ')}`), false);
  }
};

const upload = multer({
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760, // 10MB default
  },
  fileFilter: fileFilter,
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api', profileRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// MongoDB connection with error handling
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/filetransfer', { 
  useNewUrlParser: true, 
  useUnifiedTopology: true 
}).then(() => {
  console.log('Connected to MongoDB');
}).catch((err) => {
  console.error('MongoDB connection error:', err);
  process.exit(1);
});

// Create server (HTTP or HTTPS based on environment)
let server;
if (process.env.NODE_ENV === 'production' && process.env.SSL_KEY && process.env.SSL_CERT) {
  // HTTPS server for production
  const privateKey = fs.readFileSync(process.env.SSL_KEY, 'utf8');
  const certificate = fs.readFileSync(process.env.SSL_CERT, 'utf8');
  const credentials = { key: privateKey, cert: certificate };
  
  server = https.createServer(credentials, app);
  console.log('HTTPS server configured');
} else {
  // HTTP server for development
  server = http.createServer(app);
  console.log('HTTP server configured');
}

const io = socketIo(server, { 
  cors: corsOptions,
  maxHttpBufferSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760
});

let onlineUsers = {};
const fileChunks = {}; // { username_fileName: { chunks: [], totalChunks, ... } }

// Socket.io authentication middleware
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication error'));
  
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return next(new Error('Authentication error'));
    socket.user = user;
    next();
  });
});

io.on('connection', (socket) => {
  onlineUsers[socket.user.username] = socket.id;
  io.emit('onlineUsers', Object.keys(onlineUsers));

  // Chunked file transfer with validation
  socket.on('sendFileChunk', ({ to, fileName, totalChunks, currentChunk, chunkBuffer, fileSize, type }) => {
    // Validate file size
    const maxFileSize = parseInt(process.env.MAX_FILE_SIZE) || 10485760;
    if (fileSize > maxFileSize) {
      socket.emit('fileError', { message: `File size exceeds limit of ${maxFileSize} bytes` });
      return;
    }

    // Validate file type
    const allowedTypes = (process.env.ALLOWED_FILE_TYPES || '.jpg,.jpeg,.png,.gif,.pdf,.doc,.docx,.txt,.zip,.rar').split(',');
    const fileExtension = path.extname(fileName).toLowerCase();
    if (!allowedTypes.includes(fileExtension)) {
      socket.emit('fileError', { message: `File type ${fileExtension} is not allowed` });
      return;
    }

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

  // Legacy single-chunk transfer for compatibility with validation
  socket.on('sendFile', ({ to, fileName, fileBuffer }) => {
    // Validate file size
    const maxFileSize = parseInt(process.env.MAX_FILE_SIZE) || 10485760;
    if (fileBuffer.byteLength > maxFileSize) {
      socket.emit('fileError', { message: `File size exceeds limit of ${maxFileSize} bytes` });
      return;
    }

    // Validate file type
    const allowedTypes = (process.env.ALLOWED_FILE_TYPES || '.jpg,.jpeg,.png,.gif,.pdf,.doc,.docx,.txt,.zip,.rar').split(',');
    const fileExtension = path.extname(fileName).toLowerCase();
    if (!allowedTypes.includes(fileExtension)) {
      socket.emit('fileError', { message: `File type ${fileExtension} is not allowed` });
      return;
    }

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

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Max file size: ${parseInt(process.env.MAX_FILE_SIZE) || 10485760} bytes`);
});
