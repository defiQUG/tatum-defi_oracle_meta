const mongoose = require('mongoose');

const walletSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    name: {
        type: String,
        required: [true, 'Wallet name is required'],
        trim: true
    },
    type: {
        type: String,
        enum: ['ethereum', 'bitcoin', 'custom'],
        required: true
    },
    address: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        validate: {
            validator: function(v) {
                return /^0x[0-9a-fA-F]{40}$/.test(v);
            },
            message: props => `${props.value} is not a valid Ethereum address!`
        }
    },
    encryptedPrivateKey: {
        type: String,
        required: true,
        select: false
    },
    isDefault: {
        type: Boolean,
        default: false
    },
    balance: {
        type: String,
        default: '0'
    },
    lastSync: {
        type: Date,
        default: Date.now
    },
    customTokens: [{
        address: {
            type: String,
            required: true,
            validate: {
                validator: function(v) {
                    return /^0x[0-9a-fA-F]{40}$/.test(v);
                },
                message: props => `${props.value} is not a valid token address!`
            }
        },
        symbol: {
            type: String,
            required: true
        },
        decimals: {
            type: Number,
            required: true,
            min: 0,
            max: 18
        },
        balance: {
            type: String,
            default: '0'
        }
    }],
    transactions: [{
        hash: String,
        from: String,
        to: String,
        value: String,
        gasUsed: String,
        blockNumber: Number,
        timestamp: Date,
        status: {
            type: String,
            enum: ['pending', 'confirmed', 'failed'],
            default: 'pending'
        }
    }],
    active: {
        type: Boolean,
        default: true,
        select: false
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Indexes
walletSchema.index({ userId: 1, address: 1 }, { unique: true });
walletSchema.index({ userId: 1, isDefault: 1 });
walletSchema.index({ 'transactions.hash': 1 });
walletSchema.index({ 'customTokens.address': 1 });

// Pre-save middleware
walletSchema.pre('save', async function(next) {
    // If this is a new wallet and isDefault is true, unset any other default wallets
    if (this.isNew && this.isDefault) {
        await this.constructor.updateMany(
            { userId: this.userId, _id: { $ne: this._id } },
            { $set: { isDefault: false } }
        );
    }
    next();
});

// Pre-find middleware to exclude inactive wallets
walletSchema.pre(/^find/, function(next) {
    this.find({ active: { $ne: false } });
    next();
});

// Instance methods
walletSchema.methods.updateBalance = async function(newBalance) {
    this.balance = newBalance;
    this.lastSync = Date.now();
    await this.save();
};

walletSchema.methods.addTransaction = async function(transaction) {
    this.transactions.push(transaction);
    await this.save();
};

walletSchema.methods.setAsDefault = async function() {
    // Unset any other default wallets
    await this.constructor.updateMany(
        { userId: this.userId, _id: { $ne: this._id } },
        { $set: { isDefault: false } }
    );
    
    // Set this wallet as default
    this.isDefault = true;
    await this.save();
};

// Static methods
walletSchema.statics.findByAddress = function(address) {
    return this.findOne({ address: address.toLowerCase() });
};

walletSchema.statics.getDefaultWallet = function(userId) {
    return this.findOne({ userId, isDefault: true });
};

const Wallet = mongoose.model('Wallet', walletSchema);

module.exports = Wallet; 