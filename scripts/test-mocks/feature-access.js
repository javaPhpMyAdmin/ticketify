/**
 * Controllable mock for @/lib/supabase/feature-access.
 *
 * The monthly-cache hook test needs to control readMonthlyCacheRow,
 * triggerMonthlyRecalc, readCategoryTotals, and readMonthlyPurchasesTotal
 * per scenario. This mock replaces the real feature-access module at
 * require time via the require-hook redirect.
 *
 * Pattern: default implementations return safe no-ops; tests override
 * per scenario via __set* seam functions.
 */

let _readMonthlyCacheRow = async (userId, yearMonth) => ({
  status: 'ok',
  data: null,
});

let _readMonthlyCacheRows = async (userId, yearMonths) => ({
  status: 'ok',
  data: [],
});

let _triggerMonthlyRecalc = async (userId, yearMonth) => ({
  status: 'ok',
  data: undefined,
});

let _readCategoryTotals = async (yearMonth, householdId) => ({
  status: 'ok',
  data: [],
});

let _readMonthlyPurchasesTotal = async (yearMonth, householdId) => ({
  status: 'ok',
  data: [],
});

let _readCategoryBudgets = async (userId, yearMonth) => ({
  status: 'ok',
  data: [],
});

let _upsertCategoryBudgets = async (budgets, yearMonth, userId) => ({
  status: 'ok',
  data: null,
});

let _markCategoryBudgetRollover = async (budgets, yearMonth, userId) => ({
  status: 'ok',
  data: null,
});

let _readCategoryBudgetsError = null;
let _readCategoryBudgetsCallCount = 0;
let _upsertCategoryBudgetsCallCount = 0;
let _markCategoryBudgetRolloverCallCount = 0;

// --- Seam functions (harness API) ---

exports.__setReadMonthlyCacheRow = function (fn) {
  _readMonthlyCacheRow = fn;
};

exports.__setReadMonthlyCacheRows = function (fn) {
  _readMonthlyCacheRows = fn;
};

exports.__setTriggerMonthlyRecalc = function (fn) {
  _triggerMonthlyRecalc = fn;
};

exports.__setReadCategoryTotals = function (fn) {
  _readCategoryTotals = fn;
};

exports.__setReadMonthlyPurchasesTotal = function (fn) {
  _readMonthlyPurchasesTotal = fn;
};

exports.__setReadCategoryBudgets = function (fn) {
  _readCategoryBudgets = fn;
};

// Alias for the rollover slice contract — same seam as __setReadCategoryBudgets.
exports.__setReadCategoryBudgetsRows = function (fn) {
  _readCategoryBudgets = fn;
};

exports.__setReadCategoryBudgetsError = function (err) {
  _readCategoryBudgetsError = err;
};

exports.__setReadCategoryBudgetsCallCount = function (count) {
  _readCategoryBudgetsCallCount = count;
};

exports.__setUpsertCategoryBudgets = function (fn) {
  _upsertCategoryBudgets = fn;
};

exports.__setMarkCategoryBudgetRolloverApplied = function (fn) {
  _markCategoryBudgetRollover = fn;
};

exports.__setUpsertCategoryBudgetsCallCount = function (count) {
  _upsertCategoryBudgetsCallCount = count;
};

exports.__setMarkCategoryBudgetRolloverCallCount = function (count) {
  _markCategoryBudgetRolloverCallCount = count;
};

exports.__getReadCategoryBudgetsCallCount = function () {
  return _readCategoryBudgetsCallCount;
};

exports.__getUpsertCategoryBudgetsCallCount = function () {
  return _upsertCategoryBudgetsCallCount;
};

exports.__getMarkCategoryBudgetRolloverCallCount = function () {
  return _markCategoryBudgetRolloverCallCount;
};

exports.__reset = function () {
  _readMonthlyCacheRow = async () => ({ status: 'ok', data: null });
  _readMonthlyCacheRows = async () => ({ status: 'ok', data: [] });
  _triggerMonthlyRecalc = async () => ({ status: 'ok', data: undefined });
  _readCategoryTotals = async () => ({ status: 'ok', data: [] });
  _readMonthlyPurchasesTotal = async () => ({ status: 'ok', data: [] });
  _readCategoryBudgets = async () => ({ status: 'ok', data: [] });
  _upsertCategoryBudgets = async () => ({ status: 'ok', data: null });
  _markCategoryBudgetRollover = async () => ({ status: 'ok', data: null });
  _readCategoryBudgetsError = null;
  _readCategoryBudgetsCallCount = 0;
  _upsertCategoryBudgetsCallCount = 0;
  _markCategoryBudgetRolloverCallCount = 0;
};

// --- Exported functions (same signatures as the real feature-access) ---

exports.readMonthlyCacheRow = async function readMonthlyCacheRow(
  userId,
  yearMonth,
) {
  return _readMonthlyCacheRow(userId, yearMonth);
};

exports.readMonthlyCacheRows = async function readMonthlyCacheRows(
  userId,
  yearMonths,
) {
  return _readMonthlyCacheRows(userId, yearMonths);
};

exports.triggerMonthlyRecalc = async function triggerMonthlyRecalc(
  userId,
  yearMonth,
) {
  return _triggerMonthlyRecalc(userId, yearMonth);
};

exports.readCategoryTotals = async function readCategoryTotals(
  yearMonth,
  householdId,
) {
  return _readCategoryTotals(yearMonth, householdId);
};

exports.readMonthlyPurchasesTotal = async function readMonthlyPurchasesTotal(
  yearMonth,
  householdId,
) {
  return _readMonthlyPurchasesTotal(yearMonth, householdId);
};

exports.readCategoryBudgets = async function readCategoryBudgets(
  userId,
  yearMonth,
) {
  _readCategoryBudgetsCallCount += 1;
  if (_readCategoryBudgetsError) {
    // Fidelity: the real accessor maps every failure to READ_ERROR_MESSAGE.
    return {
      status: 'error',
      message: exports.READ_ERROR_MESSAGE(),
    };
  }
  return _readCategoryBudgets(userId, yearMonth);
};

exports.upsertCategoryBudgets = async function upsertCategoryBudgets(
  budgets,
  yearMonth,
  userId,
) {
  _upsertCategoryBudgetsCallCount += 1;
  return _upsertCategoryBudgets(budgets, yearMonth, userId);
};

exports.markCategoryBudgetRolloverApplied = async function markCategoryBudgetRolloverApplied(
  budgets,
  yearMonth,
  userId,
) {
  _markCategoryBudgetRolloverCallCount += 1;
  return _markCategoryBudgetRollover(budgets, yearMonth, userId);
};

/**
 * PR 2: `READ_ERROR_MESSAGE` is now a function in the real feature-access
 * seam (`feature-access.ts`). The mock mirrors the signature so consumers
 * keep compiling — call sites in the test pass `READ_ERROR_MESSAGE()`
 * (a function call) instead of `READ_ERROR_MESSAGE` (a string literal).
 */
exports.READ_ERROR_MESSAGE = function READ_ERROR_MESSAGE() {
  return 'No se pudieron cargar los datos. Inténtalo de nuevo.';
};
