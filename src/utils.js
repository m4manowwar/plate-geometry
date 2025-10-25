// Utility helpers

/**
 * Clamps a value between a minimum and maximum.
 * @param {number} v - The value to clamp.
 * @param {number} a - The minimum value.
 * @param {number} b - The maximum value.
 * @returns {number} - The clamped value.
 */
export const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

/**
 * Rounds a number to three decimal places.
 * @param {number} n - The number to round.
 * @returns {number} - The rounded number.
 */
export const round3 = (n) => Math.round(n * 1000) / 1000;

/**
 * Returns a sorted array of unique values, with an optional epsilon for precision.
 * @param {number[]} arr - The array to process.
 * @param {number} [eps=1e-6] - The epsilon for precision.
 * @returns {number[]} - The sorted array of unique values.
 */
export const uniqSorted = (arr, eps = 1e-6) => {
  const a = Array.from(new Set(arr.map((x) => Math.round(x / eps) * eps)));
  a.sort((x, y) => x - y);
  return a;
};

/**
 * Finds the index of the value in a sorted array that is closest to the target value.
 * @param {number[]} arr - The sorted array.
 * @param {number} target - The target value.
 * @returns {number} - The index of the closest value.
 */
export const findClosestIndex = (arr, target) => {
  let closest = Infinity;
  let closestIndex = -1;
  for (let i = 0; i < arr.length; i++) {
    const diff = Math.abs(arr[i] - target);
    if (diff < closest) {
      closest = diff;
      closestIndex = i;
    }
  }
  return closestIndex;
};