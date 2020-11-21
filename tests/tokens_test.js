import {detokenise} from '../src/tokens';
import * as assert from 'assert';

describe('Detokinisation', () => {
    it('should detokenise the empty string', () => {
        assert.strictEqual(detokenise(""), "");
    });
});
