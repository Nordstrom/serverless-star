const assert = require('assert')

describe('lib/index.js', () => {

  it('should load lib', () => {
    assert.strictEqual(require('../../'), require('../../lib/'))
  })

})
