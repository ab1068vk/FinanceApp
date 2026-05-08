const {
  amountToCents,
  centsToAmount,
  serializeMoney,
} = require('../../src/utils/money');

describe('money utilities', () => {
  describe('amountToCents', () => {
    test.each([
      [10, 1000],
      [10.5, 1050],
      [10.50, 1050],
      [0.01, 1],
      ['10.50', 1050],
      [0, 0],
    ])('converts %p to %p cents', (input, expected) => {
      expect(amountToCents(input)).toBe(expected);
    });

    test('converts negative amounts when explicitly allowed', () => {
      expect(amountToCents(-10.50, { allowNegative: true })).toBe(-1050);
    });

    test('throws a 400-coded error for negative amounts by default', () => {
      expect(() => amountToCents(-10.50)).toThrow('amount must be a positive number');
      try {
        amountToCents(-10.50);
      } catch (error) {
        expect(error.statusCode).toBe(400);
      }
    });

    test.each([
      0.001,
      'abc',
      null,
      Infinity,
    ])('throws for invalid input %p', (input) => {
      expect(() => amountToCents(input)).toThrow();
    });
  });

  describe('centsToAmount', () => {
    test.each([
      [1050, 10.5],
      [1, 0.01],
      [0, 0],
      [null, null],
      [undefined, undefined],
    ])('converts %p to %p', (input, expected) => {
      expect(centsToAmount(input)).toBe(expected);
    });
  });

  describe('serializeMoney', () => {
    test.each([
      [{ amount: 1050 }, { amount: 10.5 }],
      [{ balance: 0 }, { balance: 0 }],
      [{ name: 'test', amount: 500 }, { name: 'test', amount: 5 }],
      [[{ amount: 100 }, { amount: 200 }], [{ amount: 1 }, { amount: 2 }]],
      [{ account: { balance: 1000 } }, { account: { balance: 10 } }],
      [{ description: 'lunch' }, { description: 'lunch' }],
      [{ sort_order: 1 }, { sort_order: 1 }],
    ])('serializes %p', (input, expected) => {
      expect(serializeMoney(input)).toEqual(expected);
    });
  });
});
