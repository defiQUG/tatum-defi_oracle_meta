const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { promisify } = require('util');
const { logger } = require('../config/logger');
const User = require('../models/user');

// Generate JWT token
const signToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN
    });
};

// Create and send token response
const createSendToken = (user, statusCode, req, res) => {
    const token = signToken(user._id);
    const cookieOptions = {
        expires: new Date(Date.now() + process.env.JWT_COOKIE_EXPIRES_IN * 24 * 60 * 60 * 1000),
        httpOnly: true,
        secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
        sameSite: 'strict'
    };

    res.cookie('jwt', token, cookieOptions);

    user.password = undefined;

    res.status(statusCode).json({
        status: 'success',
        token,
        data: { user }
    });
};

// Register new user
exports.register = async (req, res) => {
    try {
        const { email, password, username } = req.body;

        // Check if user exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({
                status: 'error',
                message: 'Email already registered'
            });
        }

        // Create verification token
        const verificationToken = crypto.randomBytes(32).toString('hex');
        const verificationTokenExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

        // Create new user
        const user = await User.create({
            email,
            password,
            username,
            verificationToken,
            verificationTokenExpires
        });

        // Send verification email (implement email service)
        // await sendVerificationEmail(user.email, verificationToken);

        createSendToken(user, 201, req, res);
    } catch (error) {
        logger.error('Registration error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error registering user'
        });
    }
};

// Login user
exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        // Check if user exists
        const user = await User.findOne({ email }).select('+password');
        if (!user || !(await user.correctPassword(password, user.password))) {
            return res.status(401).json({
                status: 'error',
                message: 'Incorrect email or password'
            });
        }

        // Check if email is verified
        if (!user.isEmailVerified) {
            return res.status(401).json({
                status: 'error',
                message: 'Please verify your email first'
            });
        }

        createSendToken(user, 200, req, res);
    } catch (error) {
        logger.error('Login error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error logging in'
        });
    }
};

// Protect routes middleware
exports.protect = async (req, res, next) => {
    try {
        let token;
        
        // Get token from header or cookie
        if (req.headers.authorization?.startsWith('Bearer')) {
            token = req.headers.authorization.split(' ')[1];
        } else if (req.cookies.jwt) {
            token = req.cookies.jwt;
        }

        if (!token) {
            return res.status(401).json({
                status: 'error',
                message: 'Please log in to access this resource'
            });
        }

        // Verify token
        const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);

        // Check if user still exists
        const user = await User.findById(decoded.id);
        if (!user) {
            return res.status(401).json({
                status: 'error',
                message: 'User no longer exists'
            });
        }

        // Check if user changed password after token was issued
        if (user.changedPasswordAfter(decoded.iat)) {
            return res.status(401).json({
                status: 'error',
                message: 'User recently changed password. Please log in again'
            });
        }

        req.user = user;
        next();
    } catch (error) {
        logger.error('Authentication error:', error);
        res.status(401).json({
            status: 'error',
            message: 'Authentication failed'
        });
    }
};

// Logout user
exports.logout = (req, res) => {
    res.cookie('jwt', 'loggedout', {
        expires: new Date(Date.now() + 10 * 1000),
        httpOnly: true,
        secure: true
    });
    res.status(200).json({ status: 'success' });
};

// Get current user
exports.getMe = (req, res) => {
    res.status(200).json({
        status: 'success',
        data: { user: req.user }
    });
};

// Update password
exports.updatePassword = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('+password');

        if (!(await user.correctPassword(req.body.currentPassword, user.password))) {
            return res.status(401).json({
                status: 'error',
                message: 'Current password is incorrect'
            });
        }

        user.password = req.body.newPassword;
        await user.save();

        createSendToken(user, 200, req, res);
    } catch (error) {
        logger.error('Password update error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error updating password'
        });
    }
};

// Refresh token
exports.refreshToken = async (req, res) => {
    try {
        const refreshToken = req.cookies.jwt;
        
        if (!refreshToken) {
            return res.status(401).json({
                status: 'error',
                message: 'No refresh token provided'
            });
        }

        const decoded = await promisify(jwt.verify)(
            refreshToken,
            process.env.JWT_REFRESH_SECRET
        );

        const user = await User.findById(decoded.id);
        if (!user) {
            return res.status(401).json({
                status: 'error',
                message: 'Invalid refresh token'
            });
        }

        createSendToken(user, 200, req, res);
    } catch (error) {
        logger.error('Token refresh error:', error);
        res.status(401).json({
            status: 'error',
            message: 'Invalid refresh token'
        });
    }
};

// Other auth controller methods (forgotPassword, resetPassword, verifyEmail, updateMe)
// Implement these based on your specific requirements 