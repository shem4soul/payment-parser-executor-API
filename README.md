# Developer Guide

This guide explains the project structure, service patterns, endpoint conventions, middleware usage, and error-handling flow used throughout the codebase.

For deeper architectural details and internal module references, see `documentation.md`.

---

# Table of Contents

1. Project Architecture Overview
2. Setting Up a Service
3. Creating an Endpoint
4. Using Middleware
5. Error Handling
6. Testing Your Implementation
7. Common Pitfalls

---

# Project Architecture Overview

The application follows a layered architecture designed for scalability and maintainability:

```text
Request → Endpoint → Middleware → Service → Repository → Database
```

## Core Principles

* Endpoints handle routing and coordinate requests
* Services contain business logic and validation
* Repositories manage database access
* Middleware handles cross-cutting concerns like authentication and logging

## Path Aliases

```text
@app-core/*        → Core utilities
@app/services/*    → Business logic services
@app/messages/*    → Message definitions
@app/middlewares/* → Middleware functions
```

---

# Setting Up a Service

Services contain the core application logic and validation rules.

## Service Location

```text
services/[feature-group]/[service-name].js
```

Example:

```text
services/payment-processor/parse-instruction.js
```

---

# Service Template

```javascript
const validator = require('@app-core/validator');
const { throwAppError, ERROR_CODE } = require('@app-core/errors');
const { appLogger } = require('@app-core/logger');
const PaymentMessages = require('@app/messages/payment');

const spec = `root {
  accounts[] {
    id string
    balance number
    currency string
  }
  instruction string
}`;

const parsedSpec = validator.parse(spec);

async function parseInstruction(serviceData, options = {}) {
  let response;

  const data = validator.validate(serviceData, parsedSpec);

  try {
    const instruction = data.instruction.trim();
    const accounts = data.accounts;

    response = {
      status: 'successful',
      accounts,
    };
  } catch (error) {
    appLogger.errorX(error, 'parse-instruction-error');
    throw error;
  }

  return response;
}

module.exports = parseInstruction;
```

---

# Validator Spec Syntax (VSL)

The validator uses a lightweight DSL for defining schemas.

## Basic Example

```javascript
const spec = `root {
  name string
  email string
  age? number
}`;
```

## Available Types

* string
* number
* boolean
* object
* any

## Field Modifiers

```javascript
field type        // required
field? type       // optional
field[] type      // required array
field[]? type     // optional array
```

## Constraints

```javascript
email string<trim|lowercase|isEmail>
code string<uppercase|length:3>
amount number<min:1>
```

## Enum Syntax

```javascript
status string(active|inactive|pending)
```

---

# Service Conventions

## Function Signature

```javascript
async function myService(serviceData, options = {}) {}
```

## Validation First

```javascript
const data = validator.validate(serviceData, parsedSpec);
```

## Single Exit Point

```javascript
let response;

// logic

return response;
```

## Error Handling

```javascript
throwAppError(Messages.INVALID_INPUT, ERROR_CODE.INVLDDATA);
```

---

# Creating Message Files

## Location

```text
messages/[resource].js
```

## Example

```javascript
const PaymentMessages = {
  INVALID_AMOUNT: 'Amount must be positive',
  ACCOUNT_NOT_FOUND: 'Account not found',
};

module.exports = PaymentMessages;
```

## Register Messages

```javascript
module.exports = {
  PaymentMessages: require('./payment'),
};
```

---

# Creating an Endpoint

Endpoints define routes and coordinate service execution.

## Endpoint Location

```text
endpoints/[feature-group]/[endpoint-name].js
```

Example:

```text
endpoints/payment-instructions/process.js
```

---

# Endpoint Template

```javascript
const { createHandler } = require('@app-core/server');
const parseInstruction = require('@app/services/payment-processor/parse-instruction');

module.exports = createHandler({
  path: '/payment-instructions',
  method: 'post',

  middlewares: [],

  async handler(rc, helpers) {
    const payload = {
      ...rc.body,
    };

    const response = await parseInstruction(payload);

    return {
      status: helpers.http_statuses.HTTP_200_OK,
      data: response,
    };
  },
});
```

---

# HTTP Status Codes

```javascript
helpers.http_statuses.HTTP_200_OK
helpers.http_statuses.HTTP_201_CREATED
helpers.http_statuses.HTTP_400_BAD_REQUEST
helpers.http_statuses.HTTP_401_UNAUTHORIZED
helpers.http_statuses.HTTP_404_NOT_FOUND
helpers.http_statuses.HTTP_500_INTERNAL_SERVER_ERROR
```

---

# Registering Endpoints

Add the endpoint directory to `app.js`:

```javascript
const ENDPOINT_CONFIGS = [
  { path: './endpoints/payment-instructions/' },
];
```

---

# Using Middleware

Middleware executes before endpoint handlers.

## Common Middleware Use Cases

* Authentication
* Request logging
* Rate limiting
* Payload validation
* Signature verification

---

# Middleware Template

```javascript
const { createHandler } = require('@app-core/server');
const { appLogger } = require('@app-core/logger');

module.exports = createHandler({
  path: '*',

  async handler(rc) {
    appLogger.info(
      {
        method: rc.method,
        path: rc.path,
      },
      'request-received'
    );

    return {
      augments: {
        meta: {
          requestTime: Date.now(),
        },
      },
    };
  },
});
```

---

# Using Middleware in Endpoints

```javascript
middlewares: [logRequest]
```

Access middleware data:

```javascript
rc.meta.requestTime
```

---

# Error Handling

The framework provides centralized error handling utilities.

## Import Errors

```javascript
const { throwAppError, ERROR_CODE } = require('@app-core/errors');
```

## Common Error Codes

```javascript
ERROR_CODE.AUTHERR
ERROR_CODE.INVLDDATA
ERROR_CODE.NOTFOUND
ERROR_CODE.DUPLRCRD
ERROR_CODE.APPERR
```

## Throwing Errors

```javascript
throwAppError(Messages.ACCOUNT_NOT_FOUND, ERROR_CODE.NOTFOUND);
```

## Error Response Format

```json
{
  "status": "error",
  "message": "Account not found",
  "code": "NOTFOUND"
}
```

---

# Testing Your Implementation

## Start Development Server

```bash
npm run dev
```

## Example Request

```bash
curl -X POST http://localhost:3000/payment-instructions \
  -H "Content-Type: application/json" \
  -d '{
    "accounts": [],
    "instruction": "DEBIT 30 USD FROM ACCOUNT a"
  }'
```

---

# Logging

Use the built-in logger instead of `console.log`.

## Examples

```javascript
appLogger.info(data, 'log-key');

appLogger.warn(data, 'warning-key');

appLogger.error(data, 'error-key');

appLogger.errorX(data, 'critical-error-key');
```

---

# Common Pitfalls

## Validator Formatting

Correct:

```javascript
const spec = `root {
  name string
}`;
```

Incorrect:

```javascript
const spec = `root{
  name string
}`;
```

---

# Service Parameters

Correct:

```javascript
async function myService(serviceData, options = {}) {}
```

Incorrect:

```javascript
async function myService(a, b, c) {}
```

---

# Single Return Pattern

Preferred:

```javascript
let response;

// logic

return response;
```

---

# Avoid Plain Errors

Preferred:

```javascript
throwAppError(Messages.NOT_FOUND, ERROR_CODE.NOTFOUND);
```

Avoid:

```javascript
throw new Error('Not found');
```

---

# Use Path Aliases

Preferred:

```javascript
const validator = require('@app-core/validator');
```

Avoid:

```javascript
require('../../../core/validator');
```

---

# Minimal Service Example

```javascript
const validator = require('@app-core/validator');

const spec = `root {
  name string
}`;

const parsedSpec = validator.parse(spec);

async function myService(serviceData, options = {}) {
  let response;

  const data = validator.validate(serviceData, parsedSpec);

  response = data;

  return response;
}

module.exports = myService;
```

---

# Minimal Endpoint Example

```javascript
const { createHandler } = require('@app-core/server');
const myService = require('@app/services/sample/my-service');

module.exports = createHandler({
  path: '/sample',
  method: 'post',

  async handler(rc, helpers) {
    const response = await myService(rc.body);

    return {
      status: helpers.http_statuses.HTTP_200_OK,
      data: response,
    };
  },
});
```

---

# Additional Utilities

## Logger

```javascript
const { appLogger } = require('@app-core/logger');
```

## Errors

```javascript
const { throwAppError, ERROR_CODE } = require('@app-core/errors');
```

## Validator

```javascript
const validator = require('@app-core/validator');
```

## Randomness

```javascript
const { ulid, uuid } = require('@app-core/randomness');
```

## Security

```javascript
const { hash, redact } = require('@app-core/security');
```

---

# String Manipulation Notes

Preferred methods:

```javascript
.split(' ')
.indexOf('keyword')
.substring()
.slice()
.trim()
.toLowerCase()
.toUpperCase()
.replace()
.includes()
```

Avoid regex-based parsing where unnecessary.

---

# Development Notes

* Keep services focused on a single responsibility
* Validate input before processing
* Log meaningful execution steps
* Use consistent error codes
* Keep imports clean with aliases
* Structure files by feature/domain
* Favor readability and predictable flows

---

# References

See `documentation.md` for:

* Full architecture documentation
* Repository patterns
* Transactions
* Advanced validation examples
* Internal conventions
* Extended examples
