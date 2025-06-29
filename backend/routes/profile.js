const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const router = express.Router();

// Middleware to verify JWT
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  jwt.verify(token, 'SECRET', (err, user) => {
    if (err) return res.status(401).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
}

// Get current user's profile
router.get('/profile', authMiddleware, async (req, res) => {
  const user = await User.findById(req.user.id).select('-password');
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// Update current user's profile
router.put('/profile', authMiddleware, async (req, res) => {
  const { username, email, avatar, profile } = req.body;
  const user = await User.findByIdAndUpdate(
    req.user.id,
    { username, email, avatar, profile },
    { new: true }
  ).select('-password');
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

module.exports = router; 