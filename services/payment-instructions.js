/**
 * Payment Instruction Parser and Executor Service
 * Parses payment instructions and executes transactions on accounts
 */

// Supported currencies (case-insensitive)
const SUPPORTED_CURRENCIES = ['NGN', 'USD', 'GBP', 'GHS'];

// Status codes
const STATUS_CODES = {
  AM01: 'AM01', // Amount must be positive integer
  CU01: 'CU01', // Account currency mismatch
  CU02: 'CU02', // Unsupported currency
  AC01: 'AC01', // Insufficient funds
  AC02: 'AC02', // Debit and credit accounts cannot be the same
  AC03: 'AC03', // Account not found
  AC04: 'AC04', // Invalid account ID format
  DT01: 'DT01', // Invalid date format
  SY01: 'SY01', // Missing required keyword
  SY02: 'SY02', // Invalid keyword order
  SY03: 'SY03', // Malformed instruction
  AP00: 'AP00', // Transaction executed successfully
  AP02: 'AP02', // Transaction scheduled for future execution
};

/**
 * Normalize whitespace - replace multiple spaces/tabs with single space
 */
function normalizeWhitespace(str) {
  let result = '';
  let inSpace = false;
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      if (!inSpace) {
        result += ' ';
        inSpace = true;
      }
    } else {
      result += char;
      inSpace = false;
    }
  }
  return result.trim();
}

/**
 * Check if a character is valid for account ID
 * Account IDs can contain letters, numbers, hyphens (-), periods (.), and at symbols (@)
 */
function isValidAccountIdChar(char) {
  const code = char.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) || // 0-9
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    char === '-' ||
    char === '.' ||
    char === '@'
  );
}

/**
 * Validate account ID format
 */
function validateAccountId(accountId) {
  if (!accountId || accountId.length === 0) {
    return false;
  }
  for (let i = 0; i < accountId.length; i++) {
    if (!isValidAccountIdChar(accountId[i])) {
      return false;
    }
  }
  return true;
}

/**
 * Check if a string is a positive integer
 */
function isPositiveInteger(str) {
  if (!str || str.length === 0) {
    return false;
  }
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char < '0' || char > '9') {
      return false;
    }
  }
  const num = parseInt(str, 10);
  return num > 0 && num.toString() === str;
}

/**
 * Validate date format YYYY-MM-DD
 */
function isValidDateFormat(dateStr) {
  if (!dateStr || dateStr.length !== 10) {
    return false;
  }
  if (dateStr[4] !== '-' || dateStr[7] !== '-') {
    return false;
  }
  const year = dateStr.substring(0, 4);
  const month = dateStr.substring(5, 7);
  const day = dateStr.substring(8, 10);
  
  if (!isPositiveInteger(year) || !isPositiveInteger(month) || !isPositiveInteger(day)) {
    return false;
  }
  
  const yearNum = parseInt(year, 10);
  const monthNum = parseInt(month, 10);
  const dayNum = parseInt(day, 10);
  
  if (monthNum < 1 || monthNum > 12) {
    return false;
  }
  if (dayNum < 1 || dayNum > 31) {
    return false;
  }
  
  // Basic validation - could be more strict but this should work
  return true;
}

/**
 * Parse date string to Date object (UTC)
 */
function parseDate(dateStr) {
  if (!isValidDateFormat(dateStr)) {
    return null;
  }
  const year = parseInt(dateStr.substring(0, 4), 10);
  const month = parseInt(dateStr.substring(5, 7), 10) - 1; // Month is 0-indexed
  const day = parseInt(dateStr.substring(8, 10), 10);
  return new Date(Date.UTC(year, month, day));
}

/**
 * Compare dates (UTC, date only)
 */
function compareDates(date1, date2) {
  const d1 = new Date(Date.UTC(date1.getUTCFullYear(), date1.getUTCMonth(), date1.getUTCDate()));
  const d2 = new Date(Date.UTC(date2.getUTCFullYear(), date2.getUTCMonth(), date2.getUTCDate()));
  if (d1 < d2) return -1;
  if (d1 > d2) return 1;
  return 0;
}

/**
 * Find keyword in instruction (case-insensitive)
 */
function findKeyword(instruction, keyword, startIndex = 0) {
  const lowerInstruction = instruction.toLowerCase();
  const lowerKeyword = keyword.toLowerCase();
  const index = lowerInstruction.indexOf(lowerKeyword, startIndex);
  if (index === -1) {
    return -1;
  }
  // Check if it's a whole word (not part of another word)
  const before = index > 0 ? instruction[index - 1] : ' ';
  const after = index + lowerKeyword.length < instruction.length 
    ? instruction[index + lowerKeyword.length] 
    : ' ';
  if ((before === ' ' || before === '\t') && (after === ' ' || after === '\t')) {
    return index;
  }
  return -1;
}

/**
 * Extract word at position
 */
function extractWord(instruction, startIndex) {
  let endIndex = startIndex;
  while (endIndex < instruction.length && instruction[endIndex] !== ' ' && instruction[endIndex] !== '\t') {
    endIndex++;
  }
  return instruction.substring(startIndex, endIndex);
}

/**
 * Parse DEBIT format instruction
 * Format: DEBIT [amount] [currency] FROM ACCOUNT [account_id] FOR CREDIT TO ACCOUNT [account_id] [ON [date]]
 */
function parseDebitFormat(instruction) {
  const result = {
    type: 'DEBIT',
    amount: null,
    currency: null,
    debit_account: null,
    credit_account: null,
    execute_by: null,
    error: null,
  };

  // Find DEBIT keyword
  let pos = findKeyword(instruction, 'DEBIT');
  if (pos === -1) {
    result.error = { code: STATUS_CODES.SY01, reason: 'Missing required keyword: DEBIT' };
    return result;
  }

  // Extract amount (after DEBIT)
  pos += 5; // length of "DEBIT"
  while (pos < instruction.length && (instruction[pos] === ' ' || instruction[pos] === '\t')) {
    pos++;
  }
  if (pos >= instruction.length) {
    result.error = { code: STATUS_CODES.SY03, reason: 'Malformed instruction: missing amount' };
    return result;
  }

  const amountStart = pos;
  while (pos < instruction.length && instruction[pos] !== ' ' && instruction[pos] !== '\t') {
    pos++;
  }
  const amountStr = instruction.substring(amountStart, pos);

  if (!isPositiveInteger(amountStr)) {
    result.error = { code: STATUS_CODES.AM01, reason: 'Amount must be a positive integer' };
    return result;
  }
  result.amount = parseInt(amountStr, 10);

  // Extract currency (after amount)
  while (pos < instruction.length && (instruction[pos] === ' ' || instruction[pos] === '\t')) {
    pos++;
  }
  if (pos >= instruction.length) {
    result.error = { code: STATUS_CODES.SY03, reason: 'Malformed instruction: missing currency' };
    return result;
  }

  const currencyStart = pos;
  while (pos < instruction.length && instruction[pos] !== ' ' && instruction[pos] !== '\t') {
    pos++;
  }
  const currencyStr = instruction.substring(currencyStart, pos).toUpperCase();

  if (!SUPPORTED_CURRENCIES.includes(currencyStr)) {
    result.error = { code: STATUS_CODES.CU02, reason: `Unsupported currency. Only NGN, USD, GBP, and GHS are supported` };
    return result;
  }
  result.currency = currencyStr;

  // Find FROM keyword
  while (pos < instruction.length && (instruction[pos] === ' ' || instruction[pos] === '\t')) {
    pos++;
  }
  const fromPos = findKeyword(instruction, 'FROM', pos);
  if (fromPos === -1) {
    result.error = { code: STATUS_CODES.SY01, reason: 'Missing required keyword: FROM' };
    return result;
  }

  // Find ACCOUNT keyword (after FROM)
  pos = fromPos + 4; // length of "FROM"
  while (pos < instruction.length && (instruction[pos] === ' ' || instruction[pos] === '\t')) {
    pos++;
  }
  const accountPos = findKeyword(instruction, 'ACCOUNT', pos);
  if (accountPos === -1) {
    result.error = { code: STATUS_CODES.SY01, reason: 'Missing required keyword: ACCOUNT' };
    return result;
  }

  // Extract debit account ID
  pos = accountPos + 7; // length of "ACCOUNT"
  while (pos < instruction.length && (instruction[pos] === ' ' || instruction[pos] === '\t')) {
    pos++;
  }
  if (pos >= instruction.length) {
    result.error = { code: STATUS_CODES.SY03, reason: 'Malformed instruction: missing debit account ID' };
    return result;
  }

  const debitAccountStart = pos;
  while (pos < instruction.length && instruction[pos] !== ' ' && instruction[pos] !== '\t') {
    pos++;
  }
  const debitAccountId = instruction.substring(debitAccountStart, pos);

  if (!validateAccountId(debitAccountId)) {
    result.error = { code: STATUS_CODES.AC04, reason: 'Invalid account ID format' };
    return result;
  }
  result.debit_account = debitAccountId;

  // Find FOR keyword
  while (pos < instruction.length && (instruction[pos] === ' ' || instruction[pos] === '\t')) {
    pos++;
  }
  const forPos = findKeyword(instruction, 'FOR', pos);
  if (forPos === -1) {
    result.error = { code: STATUS_CODES.SY01, reason: 'Missing required keyword: FOR' };
    return result;
  }

  // Find CREDIT keyword (after FOR)
  pos = forPos + 3; // length of "FOR"
  while (pos < instruction.length && (instruction[pos] === ' ' || instruction[pos] === '\t')) {
    pos++;
  }
  const creditPos = findKeyword(instruction, 'CREDIT', pos);
  if (creditPos === -1) {
    result.error = { code: STATUS_CODES.SY01, reason: 'Missing required keyword: CREDIT' };
    return result;
  }

  // Find TO keyword (after CREDIT)
  pos = creditPos + 6; // length of "CREDIT"
  while (pos < instruction.length && (instruction[pos] === ' ' || instruction[pos] === '\t')) {
    pos++;
  }
  const toPos = findKeyword(instruction, 'TO', pos);
  if (toPos === -1) {
    result.error = { code: STATUS_CODES.SY01, reason: 'Missing required keyword: TO' };
    return result;
  }

  // Find ACCOUNT keyword (after TO)
  pos = toPos + 2; // length of "TO"
  while (pos < instruction.length && (instruction[pos] === ' ' || instruction[pos] === '\t')) {
    pos++;
  }
  const account2Pos = findKeyword(instruction, 'ACCOUNT', pos);
  if (account2Pos === -1) {
    result.error = { code: STATUS_CODES.SY01, reason: 'Missing required keyword: ACCOUNT' };
    return result;
  }

  // Extract credit account ID
  pos = account2Pos + 7; // length of "ACCOUNT"
  while (pos < instruction.length && (instruction[pos] === ' ' || instruction[pos] === '\t')) {
    pos++;
  }
  if (pos >= instruction.length) {
    result.error = { code: STATUS_CODES.SY03, reason: 'Malformed instruction: missing credit account ID' };
    return result;
  }

  const creditAccountStart = pos;
  let creditAccountEnd = pos;
  // Check if there's an ON clause
  const onPos = findKeyword(instruction, 'ON', pos);
  if (onPos !== -1) {
    creditAccountEnd = onPos;
    // Extract date
    let datePos = onPos + 2; // length of "ON"
    while (datePos < instruction.length && (instruction[datePos] === ' ' || instruction[datePos] === '\t')) {
      datePos++;
    }
    if (datePos < instruction.length) {
      const dateStart = datePos;
      while (datePos < instruction.length && instruction[datePos] !== ' ' && instruction[datePos] !== '\t') {
        datePos++;
      }
      const dateStr = instruction.substring(dateStart, datePos);
      if (!isValidDateFormat(dateStr)) {
        result.error = { code: STATUS_CODES.DT01, reason: 'Invalid date format' };
        return result;
      }
      result.execute_by = dateStr;
    }
  } else {
    creditAccountEnd = instruction.length;
  }

  // Trim the credit account ID
  while (creditAccountEnd > creditAccountStart && (instruction[creditAccountEnd - 1] === ' ' || instruction[creditAccountEnd - 1] === '\t')) {
    creditAccountEnd--;
  }
  const creditAccountId = instruction.substring(creditAccountStart, creditAccountEnd);

  if (!validateAccountId(creditAccountId)) {
    result.error = { code: STATUS_CODES.AC04, reason: 'Invalid account ID format' };
    return result;
  }
  result.credit_account = creditAccountId;

  return result;
}

/**
 * Parse CREDIT format instruction
 * Format: CREDIT [amount] [currency] TO ACCOUNT [account_id] FOR DEBIT FROM ACCOUNT [account_id] [ON [date]]
 */
function parseCreditFormat(instruction) {
  const result = {
    type: 'CREDIT',
    amount: null,
    currency: null,
    debit_account: null,
    credit_account: null,
    execute_by: null,
    error: null,
  };

  // Find CREDIT keyword
  let pos = findKeyword(instruction, 'CREDIT');
  if (pos === -1) {
    result.error = { code: STATUS_CODES.SY01, reason: 'Missing required keyword: CREDIT' };
    return result;
  }

  // Extract amount (after CREDIT)
  pos += 6; // length of "CREDIT"
  while (pos < instruction.length && (instruction[pos] === ' ' || instruction[pos] === '\t')) {
    pos++;
  }
  if (pos >= instruction.length) {
    result.error = { code: STATUS_CODES.SY03, reason: 'Malformed instruction: missing amount' };
    return result;
  }

  const amountStart = pos;
  while (pos < instruction.length && instruction[pos] !== ' ' && instruction[pos] !== '\t') {
    pos++;
  }
  const amountStr = instruction.substring(amountStart, pos);

  if (!isPositiveInteger(amountStr)) {
    result.error = { code: STATUS_CODES.AM01, reason: 'Amount must be a positive integer' };
    return result;
  }
  result.amount = parseInt(amountStr, 10);

  // Extract currency (after amount)
  while (pos < instruction.length && (instruction[pos] === ' ' || instruction[pos] === '\t')) {
    pos++;
  }
  if (pos >= instruction.length) {
    result.error = { code: STATUS_CODES.SY03, reason: 'Malformed instruction: missing currency' };
    return result;
  }

  const currencyStart = pos;
  while (pos < instruction.length && instruction[pos] !== ' ' && instruction[pos] !== '\t') {
    pos++;
  }
  const currencyStr = instruction.substring(currencyStart, pos).toUpperCase();

  if (!SUPPORTED_CURRENCIES.includes(currencyStr)) {
    result.error = { code: STATUS_CODES.CU02, reason: `Unsupported currency. Only NGN, USD, GBP, and GHS are supported` };
    return result;
  }
  result.currency = currencyStr;

  // Find TO keyword
  while (pos < instruction.length && (instruction[pos] === ' ' || instruction[pos] === '\t')) {
    pos++;
  }
  const toPos = findKeyword(instruction, 'TO', pos);
  if (toPos === -1) {
    result.error = { code: STATUS_CODES.SY01, reason: 'Missing required keyword: TO' };
    return result;
  }

  // Find ACCOUNT keyword (after TO)
  pos = toPos + 2; // length of "TO"
  while (pos < instruction.length && (instruction[pos] === ' ' || instruction[pos] === '\t')) {
    pos++;
  }
  const accountPos = findKeyword(instruction, 'ACCOUNT', pos);
  if (accountPos === -1) {
    result.error = { code: STATUS_CODES.SY01, reason: 'Missing required keyword: ACCOUNT' };
    return result;
  }

  // Extract credit account ID
  pos = accountPos + 7; // length of "ACCOUNT"
  while (pos < instruction.length && (instruction[pos] === ' ' || instruction[pos] === '\t')) {
    pos++;
  }
  if (pos >= instruction.length) {
    result.error = { code: STATUS_CODES.SY03, reason: 'Malformed instruction: missing credit account ID' };
    return result;
  }

  const creditAccountStart = pos;
  let creditAccountEnd = pos;
  // Check if there's a FOR keyword (which comes after the account ID)
  const forPosAfterAccount = findKeyword(instruction, 'FOR', pos);
  if (forPosAfterAccount !== -1) {
    creditAccountEnd = forPosAfterAccount;
  } else {
    creditAccountEnd = instruction.length;
  }

  // Trim the credit account ID
  while (creditAccountEnd > creditAccountStart && (instruction[creditAccountEnd - 1] === ' ' || instruction[creditAccountEnd - 1] === '\t')) {
    creditAccountEnd--;
  }
  const creditAccountId = instruction.substring(creditAccountStart, creditAccountEnd);

  if (!validateAccountId(creditAccountId)) {
    result.error = { code: STATUS_CODES.AC04, reason: 'Invalid account ID format' };
    return result;
  }
  result.credit_account = creditAccountId;
  
  // Update pos to after the account ID
  pos = creditAccountEnd;

  // Find FOR keyword
  while (pos < instruction.length && (instruction[pos] === ' ' || instruction[pos] === '\t')) {
    pos++;
  }
  const forPos = findKeyword(instruction, 'FOR', pos);
  if (forPos === -1) {
    result.error = { code: STATUS_CODES.SY01, reason: 'Missing required keyword: FOR' };
    return result;
  }

  // Find DEBIT keyword (after FOR)
  pos = forPos + 3; // length of "FOR"
  while (pos < instruction.length && (instruction[pos] === ' ' || instruction[pos] === '\t')) {
    pos++;
  }
  const debitPos = findKeyword(instruction, 'DEBIT', pos);
  if (debitPos === -1) {
    result.error = { code: STATUS_CODES.SY01, reason: 'Missing required keyword: DEBIT' };
    return result;
  }

  // Find FROM keyword (after DEBIT)
  pos = debitPos + 5; // length of "DEBIT"
  while (pos < instruction.length && (instruction[pos] === ' ' || instruction[pos] === '\t')) {
    pos++;
  }
  const fromPos = findKeyword(instruction, 'FROM', pos);
  if (fromPos === -1) {
    result.error = { code: STATUS_CODES.SY01, reason: 'Missing required keyword: FROM' };
    return result;
  }

  // Find ACCOUNT keyword (after FROM)
  pos = fromPos + 4; // length of "FROM"
  while (pos < instruction.length && (instruction[pos] === ' ' || instruction[pos] === '\t')) {
    pos++;
  }
  const account2Pos = findKeyword(instruction, 'ACCOUNT', pos);
  if (account2Pos === -1) {
    result.error = { code: STATUS_CODES.SY01, reason: 'Missing required keyword: ACCOUNT' };
    return result;
  }

  // Extract debit account ID
  pos = account2Pos + 7; // length of "ACCOUNT"
  while (pos < instruction.length && (instruction[pos] === ' ' || instruction[pos] === '\t')) {
    pos++;
  }
  if (pos >= instruction.length) {
    result.error = { code: STATUS_CODES.SY03, reason: 'Malformed instruction: missing debit account ID' };
    return result;
  }

  const debitAccountStart = pos;
  let debitAccountEnd = pos;
  // Check if there's an ON clause
  const onPos = findKeyword(instruction, 'ON', pos);
  if (onPos !== -1) {
    debitAccountEnd = onPos;
    // Extract date
    let datePos = onPos + 2; // length of "ON"
    while (datePos < instruction.length && (instruction[datePos] === ' ' || instruction[datePos] === '\t')) {
      datePos++;
    }
    if (datePos < instruction.length) {
      const dateStart = datePos;
      while (datePos < instruction.length && instruction[datePos] !== ' ' && instruction[datePos] !== '\t') {
        datePos++;
      }
      const dateStr = instruction.substring(dateStart, datePos);
      if (!isValidDateFormat(dateStr)) {
        result.error = { code: STATUS_CODES.DT01, reason: 'Invalid date format' };
        return result;
      }
      result.execute_by = dateStr;
    }
  } else {
    debitAccountEnd = instruction.length;
  }

  // Trim the debit account ID
  while (debitAccountEnd > debitAccountStart && (instruction[debitAccountEnd - 1] === ' ' || instruction[debitAccountEnd - 1] === '\t')) {
    debitAccountEnd--;
  }
  const debitAccountId = instruction.substring(debitAccountStart, debitAccountEnd);

  if (!validateAccountId(debitAccountId)) {
    result.error = { code: STATUS_CODES.AC04, reason: 'Invalid account ID format' };
    return result;
  }
  result.debit_account = debitAccountId;

  return result;
}

/**
 * Parse payment instruction
 */
function parseInstruction(instruction) {
  if (!instruction || typeof instruction !== 'string') {
    return {
      type: null,
      amount: null,
      currency: null,
      debit_account: null,
      credit_account: null,
      execute_by: null,
      error: { code: STATUS_CODES.SY03, reason: 'Malformed instruction: instruction must be a string' },
    };
  }

  // Normalize whitespace
  const normalized = normalizeWhitespace(instruction);

  if (normalized.length === 0) {
    return {
      type: null,
      amount: null,
      currency: null,
      debit_account: null,
      credit_account: null,
      execute_by: null,
      error: { code: STATUS_CODES.SY03, reason: 'Malformed instruction: empty instruction' },
    };
  }

  // Check which format to try first based on first keyword
  const lowerNormalized = normalized.toLowerCase();
  const hasDebit = findKeyword(normalized, 'DEBIT') !== -1;
  const hasCredit = findKeyword(normalized, 'CREDIT') !== -1;

  // Try DEBIT format if it starts with DEBIT or if CREDIT keyword is not found
  if (hasDebit && (!hasCredit || lowerNormalized.indexOf('debit') < lowerNormalized.indexOf('credit'))) {
    const debitResult = parseDebitFormat(normalized);
    if (!debitResult.error) {
      return debitResult;
    }
    // If DEBIT format failed, try CREDIT format as fallback
    if (hasCredit) {
      const creditResult = parseCreditFormat(normalized);
      if (!creditResult.error) {
        return creditResult;
      }
      // Return the more specific error
      return creditResult;
    }
    return debitResult;
  }

  // Try CREDIT format if it starts with CREDIT or if DEBIT keyword is not found
  if (hasCredit) {
    const creditResult = parseCreditFormat(normalized);
    if (!creditResult.error) {
      return creditResult;
    }
    // If CREDIT format failed, try DEBIT format as fallback
    if (hasDebit) {
      const debitResult = parseDebitFormat(normalized);
      if (!debitResult.error) {
        return debitResult;
      }
      // Return the more specific error
      return debitResult;
    }
    return creditResult;
  }

  // Neither format found
  return {
    type: null,
    amount: null,
    currency: null,
    debit_account: null,
    credit_account: null,
    execute_by: null,
    error: { code: STATUS_CODES.SY01, reason: 'Missing required keyword: DEBIT or CREDIT' },
  };
}

/**
 * Find account by ID
 */
function findAccount(accounts, accountId) {
  for (let i = 0; i < accounts.length; i++) {
    if (accounts[i].id === accountId) {
      return accounts[i];
    }
  }
  return null;
}

/**
 * Validate business rules
 */
function validateBusinessRules(parsed, accounts) {
  // Check if debit account exists
  const debitAccount = findAccount(accounts, parsed.debit_account);
  if (!debitAccount) {
    return {
      code: STATUS_CODES.AC03,
      reason: `Account not found: ${parsed.debit_account}`,
    };
  }

  // Check if credit account exists
  const creditAccount = findAccount(accounts, parsed.credit_account);
  if (!creditAccount) {
    return {
      code: STATUS_CODES.AC03,
      reason: `Account not found: ${parsed.credit_account}`,
    };
  }

  // Check if accounts are different
  if (parsed.debit_account === parsed.credit_account) {
    return {
      code: STATUS_CODES.AC02,
      reason: 'Debit and credit accounts cannot be the same',
    };
  }

  // Check currency match
  const debitCurrency = debitAccount.currency ? debitAccount.currency.toUpperCase() : null;
  const creditCurrency = creditAccount.currency ? creditAccount.currency.toUpperCase() : null;
  const parsedCurrency = parsed.currency ? parsed.currency.toUpperCase() : null;

  if (debitCurrency !== creditCurrency) {
    return {
      code: STATUS_CODES.CU01,
      reason: 'Account currency mismatch',
    };
  }

  if (parsedCurrency && debitCurrency !== parsedCurrency) {
    return {
      code: STATUS_CODES.CU01,
      reason: 'Account currency mismatch',
    };
  }

  // Check if currency is supported
  if (parsedCurrency && !SUPPORTED_CURRENCIES.includes(parsedCurrency)) {
    return {
      code: STATUS_CODES.CU02,
      reason: 'Unsupported currency. Only NGN, USD, GBP, and GHS are supported',
    };
  }

  // Check sufficient funds
  if (debitAccount.balance < parsed.amount) {
    return {
      code: STATUS_CODES.AC01,
      reason: `Insufficient funds in debit account: has ${debitAccount.balance} ${debitCurrency}, needs ${parsed.amount} ${parsedCurrency}`,
    };
  }

  return null;
}

/**
 * Get accounts in request order
 */
function getAccountsInOrder(accounts, debitAccountId, creditAccountId) {
  const result = [];

  // Add accounts in request order
  for (let i = 0; i < accounts.length; i++) {
    if (accounts[i].id === debitAccountId || accounts[i].id === creditAccountId) {
      result.push(accounts[i]);
    }
  }

  return result;
}

/**
 * Main service function
 */
async function processPaymentInstruction(serviceData) {
  const { accounts, instruction } = serviceData;

  // Validate input
  if (!accounts || !Array.isArray(accounts)) {
    return {
      type: null,
      amount: null,
      currency: null,
      debit_account: null,
      credit_account: null,
      execute_by: null,
      status: 'failed',
      status_reason: 'Invalid request: accounts must be an array',
      status_code: STATUS_CODES.SY03,
      accounts: [],
    };
  }

  if (!instruction || typeof instruction !== 'string') {
    return {
      type: null,
      amount: null,
      currency: null,
      debit_account: null,
      credit_account: null,
      execute_by: null,
      status: 'failed',
      status_reason: 'Invalid request: instruction must be a string',
      status_code: STATUS_CODES.SY03,
      accounts: [],
    };
  }

  // Parse instruction
  const parsed = parseInstruction(instruction);

  // If parsing failed completely, return error response
  if (parsed.error) {
    // If we couldn't parse at all, return null fields
    if (parsed.type === null || parsed.amount === null) {
      return {
        type: null,
        amount: null,
        currency: null,
        debit_account: null,
        credit_account: null,
        execute_by: null,
        status: 'failed',
        status_reason: parsed.error.reason,
        status_code: parsed.error.code,
        accounts: [],
      };
    }

    // If we parsed some fields but hit an error, return those fields
    return {
      type: parsed.type,
      amount: parsed.amount,
      currency: parsed.currency,
      debit_account: parsed.debit_account,
      credit_account: parsed.credit_account,
      execute_by: parsed.execute_by,
      status: 'failed',
      status_reason: parsed.error.reason,
      status_code: parsed.error.code,
      accounts: getAccountsInOrder(accounts, parsed.debit_account, parsed.credit_account).map(acc => ({
        id: acc.id,
        balance: acc.balance,
        balance_before: acc.balance,
        currency: acc.currency ? acc.currency.toUpperCase() : acc.currency,
      })),
    };
  }

  // Validate business rules
  const validationError = validateBusinessRules(parsed, accounts);
  if (validationError) {
    return {
      type: parsed.type,
      amount: parsed.amount,
      currency: parsed.currency,
      debit_account: parsed.debit_account,
      credit_account: parsed.credit_account,
      execute_by: parsed.execute_by,
      status: 'failed',
      status_reason: validationError.reason,
      status_code: validationError.code,
      accounts: getAccountsInOrder(accounts, parsed.debit_account, parsed.credit_account).map(acc => ({
        id: acc.id,
        balance: acc.balance,
        balance_before: acc.balance,
        currency: acc.currency ? acc.currency.toUpperCase() : acc.currency,
      })),
    };
  }

  // Check execution date
  const debitAccount = findAccount(accounts, parsed.debit_account);
  const creditAccount = findAccount(accounts, parsed.credit_account);
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  let shouldExecute = true;
  if (parsed.execute_by) {
    const executeDate = parseDate(parsed.execute_by);
    if (executeDate) {
      const compare = compareDates(executeDate, today);
      if (compare > 0) {
        // Future date - mark as pending
        shouldExecute = false;
      }
    }
  }

  // Execute transaction or mark as pending
  if (shouldExecute) {
    // Execute immediately
    debitAccount.balance -= parsed.amount;
    creditAccount.balance += parsed.amount;

    return {
      type: parsed.type,
      amount: parsed.amount,
      currency: parsed.currency,
      debit_account: parsed.debit_account,
      credit_account: parsed.credit_account,
      execute_by: parsed.execute_by,
      status: 'successful',
      status_reason: 'Transaction executed successfully',
      status_code: STATUS_CODES.AP00,
      accounts: getAccountsInOrder(accounts, parsed.debit_account, parsed.credit_account).map(acc => {
        const originalBalance = acc.id === parsed.debit_account 
          ? debitAccount.balance + parsed.amount 
          : acc.id === parsed.credit_account 
            ? creditAccount.balance - parsed.amount 
            : acc.balance;
        return {
          id: acc.id,
          balance: acc.balance,
          balance_before: originalBalance,
          currency: acc.currency ? acc.currency.toUpperCase() : acc.currency,
        };
      }),
    };
  } else {
    // Mark as pending
    return {
      type: parsed.type,
      amount: parsed.amount,
      currency: parsed.currency,
      debit_account: parsed.debit_account,
      credit_account: parsed.credit_account,
      execute_by: parsed.execute_by,
      status: 'pending',
      status_reason: 'Transaction scheduled for future execution',
      status_code: STATUS_CODES.AP02,
      accounts: getAccountsInOrder(accounts, parsed.debit_account, parsed.credit_account).map(acc => ({
        id: acc.id,
        balance: acc.balance,
        balance_before: acc.balance,
        currency: acc.currency ? acc.currency.toUpperCase() : acc.currency,
      })),
    };
  }
}

module.exports = processPaymentInstruction;

