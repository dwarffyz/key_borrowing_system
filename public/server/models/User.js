const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    firstName: {
        type: String,
        required: true,
        trim: true
    },
    lastName: {
        type: String,
        required: true,
        trim: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email address']
    },
    password: {
        type: String,
        required: true,
        minlength: 6
    },
    role: {
        type: String,
        enum: ['teacher', 'admin'],
        default: 'teacher'
    },
    department: {
        type: String,
        trim: true
    },
    isActive: {
        type: Boolean,
        default: true
    },
    emailVerified: {
        type: Boolean,
        default: true
    },
    emailVerificationCodeHash: {
        type: String
    },
    emailVerificationExpiresAt: {
        type: Date
    },
    emailVerificationAttempts: {
        type: Number,
        default: 0
    },
    emailVerificationSentAt: {
        type: Date
    },
    approvalStatus: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'approved'
    },
    approvedAt: {
        type: Date
    },
    approvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Admin'
    },
    rejectedAt: {
        type: Date
    },
    rejectedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Admin'
    },
    lastNotificationSeenAt: {
        type: Date
    },
    dismissedPopupAnnouncementId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Announcement'
    },
    dismissedPopupAt: {
        type: Date
    },
    lastLogin: {
        type: Date
    },
    passwordChangedAt: {
        type: Date
    },
    resetPasswordTokenHash: {
        type: String
    },
    resetPasswordExpiresAt: {
        type: Date
    },
    profilePhoto: {
        type: String
    },
    profilePhotoUpdatedAt: {
        type: Date
    }
}, {
    timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    
    try {
        this.passwordChangedAt = new Date();
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (error) {
        next(error);
    }
});

// Method to compare password
userSchema.methods.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
