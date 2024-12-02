const { validationResult } = require('express-validator');
const { logger } = require('../config/logger');
const errorHandler = require('./errorHandler');
const Web3 = require('web3');

class ValidationService {
    constructor() {
        this.web3 = new Web3();
        this.customValidators = new Map();
        this.setupCustomValidators();
    }

    setupCustomValidators() {
        // Blockchain-specific validators
        this.customValidators.set('isEthereumAddress', {
            validator: (value) => this.web3.utils.isAddress(value),
            message: 'Invalid Ethereum address'
        });

        this.customValidators.set('isTransactionHash', {
            validator: (value) => /^0x([A-Fa-f0-9]{64})$/.test(value),
            message: 'Invalid transaction hash'
        });

        this.customValidators.set('isPrivateKey', {
            validator: (value) => /^0x[0-9a-fA-F]{64}$/.test(value),
            message: 'Invalid private key format'
        });

        // General validators
        this.customValidators.set('isStrongPassword', {
            validator: (value) => {
                const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
                return strongPasswordRegex.test(value);
            },
            message: 'Password must contain at least 8 characters, one uppercase letter, one lowercase letter, one number and one special character'
        });

        this.customValidators.set('isValidUsername', {
            validator: (value) => /^[a-zA-Z0-9_]{3,20}$/.test(value),
            message: 'Username must be 3-20 characters long and contain only letters, numbers, and underscores'
        });

        this.customValidators.set('isValidAmount', {
            validator: (value) => {
                try {
                    const amount = parseFloat(value);
                    return amount > 0 && amount <= Number.MAX_SAFE_INTEGER;
                } catch {
                    return false;
                }
            },
            message: 'Invalid amount'
        });

        this.customValidators.set('isValidGasPrice', {
            validator: (value) => {
                try {
                    const gasPrice = this.web3.utils.toBN(value);
                    return gasPrice.gte(this.web3.utils.toBN(0));
                } catch {
                    return false;
                }
            },
            message: 'Invalid gas price'
        });

        this.customValidators.set('isValidGasLimit', {
            validator: (value) => {
                try {
                    const gasLimit = this.web3.utils.toBN(value);
                    return gasLimit.gte(this.web3.utils.toBN(21000)); // Minimum gas limit
                } catch {
                    return false;
                }
            },
            message: 'Invalid gas limit'
        });
    }

    // Express middleware for validation
    validate(validations) {
        return async (req, res, next) => {
            try {
                // Run express-validator validations
                await Promise.all(validations.map(validation => validation.run(req)));

                const errors = validationResult(req);
                if (!errors.isEmpty()) {
                    const error = errorHandler.createError(
                        errorHandler.errorTypes.VALIDATION,
                        'Validation failed',
                        { errors: errors.array() }
                    );
                    return errorHandler.handleError(error, req, res);
                }

                next();
            } catch (error) {
                errorHandler.handleError(error, req, res);
            }
        };
    }

    // Custom validation middleware
    validateCustom(field, validatorName, options = {}) {
        return async (req, res, next) => {
            try {
                const value = this.getFieldValue(req, field);
                const validator = this.customValidators.get(validatorName);

                if (!validator) {
                    throw new Error(`Validator ${validatorName} not found`);
                }

                const isValid = await validator.validator(value, options);
                if (!isValid) {
                    const error = errorHandler.createError(
                        errorHandler.errorTypes.VALIDATION,
                        validator.message,
                        { field, value }
                    );
                    return errorHandler.handleError(error, req, res);
                }

                next();
            } catch (error) {
                errorHandler.handleError(error, req, res);
            }
        };
    }

    // Validate object against schema
    validateSchema(data, schema) {
        const errors = [];
        
        for (const [field, rules] of Object.entries(schema)) {
            const value = data[field];
            
            // Required field check
            if (rules.required && (value === undefined || value === null || value === '')) {
                errors.push({
                    field,
                    message: `${field} is required`
                });
                continue;
            }

            // Skip other validations if field is not required and empty
            if (!rules.required && (value === undefined || value === null || value === '')) {
                continue;
            }

            // Type validation
            if (rules.type && typeof value !== rules.type) {
                errors.push({
                    field,
                    message: `${field} must be of type ${rules.type}`
                });
            }

            // Custom validator
            if (rules.validator && this.customValidators.has(rules.validator)) {
                const validator = this.customValidators.get(rules.validator);
                if (!validator.validator(value)) {
                    errors.push({
                        field,
                        message: validator.message
                    });
                }
            }

            // Min/Max validation for numbers
            if (typeof value === 'number') {
                if (rules.min !== undefined && value < rules.min) {
                    errors.push({
                        field,
                        message: `${field} must be greater than or equal to ${rules.min}`
                    });
                }
                if (rules.max !== undefined && value > rules.max) {
                    errors.push({
                        field,
                        message: `${field} must be less than or equal to ${rules.max}`
                    });
                }
            }

            // Length validation for strings and arrays
            if (typeof value === 'string' || Array.isArray(value)) {
                if (rules.minLength !== undefined && value.length < rules.minLength) {
                    errors.push({
                        field,
                        message: `${field} must be at least ${rules.minLength} characters long`
                    });
                }
                if (rules.maxLength !== undefined && value.length > rules.maxLength) {
                    errors.push({
                        field,
                        message: `${field} must be no more than ${rules.maxLength} characters long`
                    });
                }
            }

            // Pattern validation for strings
            if (typeof value === 'string' && rules.pattern && !rules.pattern.test(value)) {
                  errors.push({
                      field,
                      message: rules.patternMessage || `${field} format is invalid`
                  });
            }

            // Enum validation
            if (rules.enum && !rules.enum.includes(value)) {
                errors.push({
                    field,
                    message: `${field} must be one of: ${rules.enum.join(', ')}`
                });
            }
        }

        return errors;
    }

    // Helper method to get field value from request
    getFieldValue(req, field) {
        const parts = field.split('.');
        let value = req;
        
        for (const part of parts) {
            if (value === undefined || value === null) {
              return undefined;
            }
            value = value[part];
        }
        
        return value;
    }

    // Add custom validator
    addValidator(name, validator, message) {
        this.customValidators.set(name, { validator, message });
    }

    // Get custom validator
    getValidator(name) {
        return this.customValidators.get(name);
    }

    // Create validation schema
    createSchema(schema) {
        return {
            validate: (data) => this.validateSchema(data, schema)
        };
    }
}

module.exports = new ValidationService(); 