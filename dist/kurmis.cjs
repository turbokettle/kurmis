#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/.pnpm/toml-eslint-parser@0.10.0/node_modules/toml-eslint-parser/lib/internal-utils/index.js
var require_internal_utils = __commonJS({
  "node_modules/.pnpm/toml-eslint-parser@0.10.0/node_modules/toml-eslint-parser/lib/internal-utils/index.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.toKeyName = exports2.last = void 0;
    function last(arr) {
      var _a;
      return (_a = arr[arr.length - 1]) !== null && _a !== void 0 ? _a : null;
    }
    exports2.last = last;
    function toKeyName(node) {
      return node.type === "TOMLBare" ? node.name : node.value;
    }
    exports2.toKeyName = toKeyName;
  }
});

// node_modules/.pnpm/toml-eslint-parser@0.10.0/node_modules/toml-eslint-parser/lib/parser-options.js
var require_parser_options = __commonJS({
  "node_modules/.pnpm/toml-eslint-parser@0.10.0/node_modules/toml-eslint-parser/lib/parser-options.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.getTOMLVer = void 0;
    var TOMLVerImpl = class {
      constructor(major, minor) {
        this.major = major;
        this.minor = minor;
      }
      lt(major, minor) {
        return this.major < major || this.major === major && this.minor < minor;
      }
      gte(major, minor) {
        return this.major > major || this.major === major && this.minor >= minor;
      }
    };
    var TOML_VERSION_1_0 = new TOMLVerImpl(1, 0);
    var TOML_VERSION_1_1 = new TOMLVerImpl(1, 1);
    var DEFAULT_TOML_VERSION = TOML_VERSION_1_0;
    var SUPPORTED_TOML_VERSIONS = {
      "1.0": TOML_VERSION_1_0,
      "1.0.0": TOML_VERSION_1_0,
      "1.1": TOML_VERSION_1_1,
      "1.1.0": TOML_VERSION_1_1,
      latest: TOML_VERSION_1_0,
      next: TOML_VERSION_1_1
    };
    function getTOMLVer(v) {
      return SUPPORTED_TOML_VERSIONS[v || "latest"] || DEFAULT_TOML_VERSION;
    }
    exports2.getTOMLVer = getTOMLVer;
  }
});

// node_modules/.pnpm/toml-eslint-parser@0.10.0/node_modules/toml-eslint-parser/lib/errors.js
var require_errors = __commonJS({
  "node_modules/.pnpm/toml-eslint-parser@0.10.0/node_modules/toml-eslint-parser/lib/errors.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.ParseError = void 0;
    var MESSAGES = {
      "unterminated-string": "Unterminated string constant",
      "unterminated-table-key": "Unterminated table-key",
      "unterminated-array": "Unterminated array",
      "unterminated-inline-table": "Unterminated inline table",
      "missing-key": "Empty bare keys are not allowed",
      "missing-newline": "Must be a newline",
      "missing-equals-sign": "Expected equal (=) token",
      "missing-value": "Unspecified values are invalid",
      "missing-comma": "Expected comma (,) token",
      "dupe-keys": "Defining a key multiple times is invalid",
      "unexpected-char": "Unexpected character",
      "unexpected-token": "Unexpected token",
      "invalid-control-character": "Control characters (codes < 0x1f and 0x7f) are not allowed",
      "invalid-comment-character": "Invalid code point {{cp}} within comments",
      "invalid-key-value-newline": "The key, equals sign, and value must be on the same line",
      "invalid-inline-table-newline": "No newlines are allowed between the curly braces unless they are valid within a value",
      "invalid-underscore": "Underscores are allowed between digits",
      "invalid-space": "Unexpected spaces",
      "invalid-three-quotes": "Three or more quotes are not permitted",
      "invalid-date": "Unexpected invalid date",
      "invalid-time": "Unexpected invalid time",
      "invalid-leading-zero": "Leading zeros are not allowed",
      "invalid-trailing-comma-in-inline-table": "Trailing comma is not permitted in an inline table",
      "invalid-char-in-escape-sequence": "Invalid character in escape sequence",
      "invalid-code-point": "Invalid code point {{cp}}"
    };
    function getMessage(code, data) {
      if (data) {
        return MESSAGES[code].replace(/\{\{(.*?)\}\}/gu, (_, name) => {
          if (name in data) {
            return data[name];
          }
          return `{{${name}}}`;
        });
      }
      return MESSAGES[code];
    }
    var ParseError = class extends SyntaxError {
      /**
       * Initialize this ParseError instance.
       *
       */
      constructor(code, offset, line, column, data) {
        super(getMessage(code, data));
        this.index = offset;
        this.lineNumber = line;
        this.column = column;
      }
    };
    exports2.ParseError = ParseError;
  }
});

// node_modules/.pnpm/toml-eslint-parser@0.10.0/node_modules/toml-eslint-parser/lib/tokenizer/locs.js
var require_locs = __commonJS({
  "node_modules/.pnpm/toml-eslint-parser@0.10.0/node_modules/toml-eslint-parser/lib/tokenizer/locs.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.Locations = void 0;
    function sortedLastIndex(array, value) {
      let low = 0;
      let high = array.length;
      while (low < high) {
        const mid = low + high >>> 1;
        const val = array[mid];
        if (val === value)
          return mid + 1;
        if (val < value) {
          low = mid + 1;
        } else {
          high = mid;
        }
      }
      return low;
    }
    var Locations = class {
      constructor() {
        this.offsets = [];
      }
      addOffset(offset) {
        for (let i = this.offsets.length - 1; i >= 0; i--) {
          const element = this.offsets[i];
          if (element === offset)
            return;
          if (element < offset)
            break;
        }
        this.offsets.push(offset);
      }
      /**
       * Calculate the location of the given index.
       * @param index The index to calculate their location.
       * @returns The location of the index.
       */
      getLocFromIndex(offset) {
        const line = sortedLastIndex(this.offsets, offset) + 1;
        const column = offset - (line === 1 ? 0 : this.offsets[line - 2]);
        return { line, column };
      }
    };
    exports2.Locations = Locations;
  }
});

// node_modules/.pnpm/toml-eslint-parser@0.10.0/node_modules/toml-eslint-parser/lib/tokenizer/code-point-iterator.js
var require_code_point_iterator = __commonJS({
  "node_modules/.pnpm/toml-eslint-parser@0.10.0/node_modules/toml-eslint-parser/lib/tokenizer/code-point-iterator.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.CodePointIterator = void 0;
    var locs_1 = require_locs();
    var CodePointIterator = class {
      /**
       * Initialize this char iterator.
       */
      constructor(text2) {
        this.locs = new locs_1.Locations();
        this.lastCodePoint = 0;
        this.start = -1;
        this.end = 0;
        this.text = text2;
      }
      next() {
        if (this.lastCodePoint === -1) {
          return -1;
        }
        return this.lastCodePoint = this.moveAt(this.end);
      }
      getStartLoc() {
        return this.getLocFromIndex(this.start);
      }
      getEndLoc() {
        return this.getLocFromIndex(this.end);
      }
      getLocFromIndex(index) {
        return this.locs.getLocFromIndex(index);
      }
      eat(cp) {
        if (this.text.codePointAt(this.end) === cp) {
          this.next();
          return true;
        }
        return false;
      }
      moveAt(offset) {
        var _a;
        this.start = this.end = offset;
        const cp = (_a = this.text.codePointAt(this.start)) !== null && _a !== void 0 ? _a : -1;
        if (cp === -1) {
          this.end = this.start;
          return cp;
        }
        const shift = cp >= 65536 ? 2 : 1;
        this.end += shift;
        if (cp === 10) {
          this.locs.addOffset(this.end);
        } else if (cp === 13) {
          if (this.text.codePointAt(this.end) === 10) {
            this.end++;
            this.locs.addOffset(this.end);
          }
          return 10;
        }
        return cp;
      }
    };
    exports2.CodePointIterator = CodePointIterator;
  }
});

// node_modules/.pnpm/toml-eslint-parser@0.10.0/node_modules/toml-eslint-parser/lib/tokenizer/code-point.js
var require_code_point = __commonJS({
  "node_modules/.pnpm/toml-eslint-parser@0.10.0/node_modules/toml-eslint-parser/lib/tokenizer/code-point.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.isUnicodeScalarValue = exports2.isLowSurrogate = exports2.isHighSurrogate = exports2.isOctalDig = exports2.isHexDig = exports2.isDigit = exports2.isLetter = exports2.isEOL = exports2.isWhitespace = exports2.isControl = void 0;
    function isControl(cp) {
      return cp >= 0 && cp <= 31;
    }
    exports2.isControl = isControl;
    function isWhitespace3(cp) {
      return cp === 9 || cp === 32;
    }
    exports2.isWhitespace = isWhitespace3;
    function isEOL(cp) {
      return cp === 10 || cp === 13;
    }
    exports2.isEOL = isEOL;
    function isUpperLetter(cp) {
      return cp >= 65 && cp <= 90;
    }
    function isLowerLetter(cp) {
      return cp >= 97 && cp <= 122;
    }
    function isLetter(cp) {
      return isLowerLetter(cp) || isUpperLetter(cp);
    }
    exports2.isLetter = isLetter;
    function isDigit(cp) {
      return cp >= 48 && cp <= 57;
    }
    exports2.isDigit = isDigit;
    function isHexDig(cp) {
      return isDigit(cp) || cp >= 97 && cp <= 102 || cp >= 65 && cp <= 70;
    }
    exports2.isHexDig = isHexDig;
    function isOctalDig(cp) {
      return cp >= 48 && cp <= 55;
    }
    exports2.isOctalDig = isOctalDig;
    function isHighSurrogate(cp) {
      return cp >= 55296 && cp <= 57343;
    }
    exports2.isHighSurrogate = isHighSurrogate;
    function isLowSurrogate(cp) {
      return cp >= 56320 && cp <= 57343;
    }
    exports2.isLowSurrogate = isLowSurrogate;
    function isUnicodeScalarValue(cp) {
      return cp >= 0 && cp <= 55295 || cp >= 57344 && cp <= 1114111;
    }
    exports2.isUnicodeScalarValue = isUnicodeScalarValue;
  }
});

// node_modules/.pnpm/toml-eslint-parser@0.10.0/node_modules/toml-eslint-parser/lib/tokenizer/tokenizer.js
var require_tokenizer = __commonJS({
  "node_modules/.pnpm/toml-eslint-parser@0.10.0/node_modules/toml-eslint-parser/lib/tokenizer/tokenizer.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.Tokenizer = void 0;
    var errors_1 = require_errors();
    var parser_options_1 = require_parser_options();
    var code_point_iterator_1 = require_code_point_iterator();
    var code_point_1 = require_code_point();
    var HAS_BIGINT = typeof BigInt !== "undefined";
    var RADIX_PREFIXES = {
      16: "0x",
      10: "",
      8: "0o",
      2: "0b"
    };
    var ESCAPES_1_0 = {
      // escape-seq-char =  %x22         ; "    quotation mark  U+0022
      [
        34
        /* CodePoint.QUOTATION_MARK */
      ]: 34,
      // escape-seq-char =/ %x5C         ; \    reverse solidus U+005C
      [
        92
        /* CodePoint.BACKSLASH */
      ]: 92,
      // escape-seq-char =/ %x62         ; b    backspace       U+0008
      [
        98
        /* CodePoint.LATIN_SMALL_B */
      ]: 8,
      // escape-seq-char =/ %x66         ; f    form feed       U+000C
      [
        102
        /* CodePoint.LATIN_SMALL_F */
      ]: 12,
      // escape-seq-char =/ %x6E         ; n    line feed       U+000A
      [
        110
        /* CodePoint.LATIN_SMALL_N */
      ]: 10,
      // escape-seq-char =/ %x72         ; r    carriage return U+000D
      [
        114
        /* CodePoint.LATIN_SMALL_R */
      ]: 13,
      // escape-seq-char =/ %x74         ; t    tab             U+0009
      [
        116
        /* CodePoint.LATIN_SMALL_T */
      ]: 9
    };
    var ESCAPES_LATEST = Object.assign(Object.assign({}, ESCAPES_1_0), {
      // escape-seq-char =/ %x65         ; e    escape          U+001B
      // Added in TOML 1.1
      [
        101
        /* CodePoint.LATIN_SMALL_E */
      ]: 27
      /* CodePoint.ESCAPE */
    });
    var Tokenizer = class {
      /**
       * Initialize this tokenizer.
       */
      constructor(text2, parserOptions) {
        this.backCode = false;
        this.lastCodePoint = 0;
        this.state = "DATA";
        this.token = null;
        this.tokenStart = -1;
        this.valuesEnabled = false;
        this.text = text2;
        this.parserOptions = parserOptions || {};
        this.codePointIterator = new code_point_iterator_1.CodePointIterator(text2);
        this.tomlVersion = (0, parser_options_1.getTOMLVer)(this.parserOptions.tomlVersion);
        this.ESCAPES = this.tomlVersion.gte(1, 1) ? ESCAPES_LATEST : ESCAPES_1_0;
      }
      get positions() {
        return {
          start: Object.assign(Object.assign({}, this.codePointIterator.getStartLoc()), { offset: this.codePointIterator.start }),
          end: Object.assign(Object.assign({}, this.codePointIterator.getEndLoc()), { offset: this.codePointIterator.end })
        };
      }
      /**
       * Report an invalid character error.
       */
      reportParseError(code, data) {
        const loc = this.codePointIterator.getStartLoc();
        throw new errors_1.ParseError(code, this.codePointIterator.start, loc.line, loc.column, data);
      }
      /**
       * Get the next token.
       */
      nextToken() {
        let token = this.token;
        if (token != null) {
          this.token = null;
          return token;
        }
        let cp = this.lastCodePoint;
        while (cp !== -1 && !this.token) {
          cp = this.nextCode();
          const nextState = this[this.state](cp);
          if (!nextState) {
            throw new Error(`Unknown error: pre state=${this.state}`);
          }
          this.state = nextState;
        }
        token = this.token;
        this.token = null;
        return token;
      }
      /**
       * Get the next code point.
       */
      nextCode() {
        if (this.lastCodePoint === -1) {
          return -1;
        }
        if (this.backCode) {
          this.backCode = false;
          return this.lastCodePoint;
        }
        return this.lastCodePoint = this.codePointIterator.next();
      }
      /**
       * Eat the next code point.
       */
      eatCode(cp) {
        if (this.lastCodePoint === -1) {
          return false;
        }
        if (this.backCode) {
          if (this.lastCodePoint === cp) {
            this.backCode = false;
            return true;
          }
          return false;
        }
        return this.codePointIterator.eat(cp);
      }
      /**
       * Moves the character position to the given position.
       */
      moveAt(loc) {
        if (this.backCode) {
          this.backCode = false;
        }
        this.lastCodePoint = this.codePointIterator.moveAt(loc);
      }
      /**
       * Back the current code point as the given state.
       */
      back(state) {
        this.backCode = true;
        return state;
      }
      punctuatorToken() {
        this.startToken();
        this.endToken("Punctuator", "end");
      }
      startToken() {
        this.tokenStart = this.codePointIterator.start;
      }
      /**
       * Commit the current token.
       */
      endToken(type, pos, option1, option2) {
        const { tokenStart } = this;
        const end = this.codePointIterator[pos];
        const range = [tokenStart, end];
        const loc = {
          start: this.codePointIterator.getLocFromIndex(tokenStart),
          end: this.codePointIterator.getLocFromIndex(end)
        };
        if (type === "Block") {
          this.token = {
            type,
            value: this.text.slice(tokenStart + 1, end),
            range,
            loc
          };
        } else {
          let token;
          const value = this.text.slice(tokenStart, end);
          if (type === "BasicString" || type === "LiteralString" || type === "MultiLineBasicString" || type === "MultiLineLiteralString") {
            token = {
              type,
              value,
              string: option1,
              range,
              loc
            };
          } else if (type === "Integer") {
            const text2 = option1;
            token = {
              type,
              value,
              number: parseInt(text2, option2),
              bigint: HAS_BIGINT ? BigInt(RADIX_PREFIXES[option2] + text2) : null,
              range,
              loc
            };
          } else if (type === "Float") {
            token = {
              type,
              value,
              number: option1,
              range,
              loc
            };
          } else if (type === "Boolean") {
            token = {
              type,
              value,
              boolean: option1,
              range,
              loc
            };
          } else if (type === "LocalDate" || type === "LocalTime" || type === "LocalDateTime" || type === "OffsetDateTime") {
            token = {
              type,
              value,
              date: option1,
              range,
              loc
            };
          } else {
            token = {
              type,
              value,
              range,
              loc
            };
          }
          this.token = token;
        }
      }
      DATA(cp) {
        while ((0, code_point_1.isWhitespace)(cp) || (0, code_point_1.isEOL)(cp)) {
          cp = this.nextCode();
        }
        if (cp === 35) {
          this.startToken();
          return "COMMENT";
        }
        if (cp === 34) {
          this.startToken();
          return "BASIC_STRING";
        }
        if (cp === 39) {
          this.startToken();
          return "LITERAL_STRING";
        }
        if (cp === 46 || // .
        cp === 61 || // =
        cp === 91 || // [
        cp === 93 || // ]
        cp === 123 || // {
        cp === 125 || // }
        cp === 44) {
          this.punctuatorToken();
          return "DATA";
        }
        if (this.valuesEnabled) {
          if (cp === 45 || cp === 43) {
            this.startToken();
            return "SIGN";
          }
          if (cp === 110 || cp === 105) {
            this.startToken();
            return this.back("NAN_OR_INF");
          }
          if ((0, code_point_1.isDigit)(cp)) {
            this.startToken();
            return this.back("NUMBER");
          }
          if (cp === 116 || cp === 102) {
            this.startToken();
            return this.back("BOOLEAN");
          }
        } else {
          if (isUnquotedKeyChar(cp, this.tomlVersion)) {
            this.startToken();
            return "BARE";
          }
        }
        if (cp === -1) {
          return "DATA";
        }
        return this.reportParseError("unexpected-char");
      }
      COMMENT(cp) {
        const processCommentChar = this.tomlVersion.gte(1, 1) ? (c) => {
          if (!isAllowedCommentCharacter(c)) {
            this.reportParseError("invalid-comment-character");
          }
        } : (c) => {
          if (isControlOtherThanTab(c)) {
            this.reportParseErrorControlChar();
          }
        };
        while (!(0, code_point_1.isEOL)(cp) && cp !== -1) {
          processCommentChar(cp);
          cp = this.nextCode();
        }
        this.endToken("Block", "start");
        return "DATA";
      }
      BARE(cp) {
        while (isUnquotedKeyChar(cp, this.tomlVersion)) {
          cp = this.nextCode();
        }
        this.endToken("Bare", "start");
        return this.back("DATA");
      }
      BASIC_STRING(cp) {
        if (cp === 34) {
          cp = this.nextCode();
          if (cp === 34) {
            return "MULTI_LINE_BASIC_STRING";
          }
          this.endToken("BasicString", "start", "");
          return this.back("DATA");
        }
        const out = [];
        while (cp !== 34 && cp !== -1 && cp !== 10) {
          if (isControlOtherThanTab(cp)) {
            return this.reportParseErrorControlChar();
          }
          if (cp === 92) {
            cp = this.nextCode();
            const ecp = this.ESCAPES[cp];
            if (ecp) {
              out.push(ecp);
              cp = this.nextCode();
              continue;
            } else if (cp === 117) {
              const code = this.parseUnicode(4);
              out.push(code);
              cp = this.nextCode();
              continue;
            } else if (cp === 85) {
              const code = this.parseUnicode(8);
              out.push(code);
              cp = this.nextCode();
              continue;
            } else if (cp === 120 && this.tomlVersion.gte(1, 1)) {
              const code = this.parseUnicode(2);
              out.push(code);
              cp = this.nextCode();
              continue;
            }
            return this.reportParseError("invalid-char-in-escape-sequence");
          }
          out.push(cp);
          cp = this.nextCode();
        }
        if (cp !== 34) {
          return this.reportParseError("unterminated-string");
        }
        this.endToken("BasicString", "end", String.fromCodePoint(...out));
        return "DATA";
      }
      MULTI_LINE_BASIC_STRING(cp) {
        const out = [];
        if (cp === 10) {
          cp = this.nextCode();
        }
        while (cp !== -1) {
          if (cp !== 10 && isControlOtherThanTab(cp)) {
            return this.reportParseErrorControlChar();
          }
          if (cp === 34) {
            const startPos = this.codePointIterator.start;
            if (this.eatCode(
              34
              /* CodePoint.QUOTATION_MARK */
            ) && this.eatCode(
              34
              /* CodePoint.QUOTATION_MARK */
            )) {
              if (this.eatCode(
                34
                /* CodePoint.QUOTATION_MARK */
              )) {
                out.push(
                  34
                  /* CodePoint.QUOTATION_MARK */
                );
                if (this.eatCode(
                  34
                  /* CodePoint.QUOTATION_MARK */
                )) {
                  out.push(
                    34
                    /* CodePoint.QUOTATION_MARK */
                  );
                  if (this.eatCode(
                    34
                    /* CodePoint.QUOTATION_MARK */
                  )) {
                    this.moveAt(startPos);
                    return this.reportParseError("invalid-three-quotes");
                  }
                }
              }
              this.endToken("MultiLineBasicString", "end", String.fromCodePoint(...out));
              return "DATA";
            }
            this.moveAt(startPos);
          }
          if (cp === 92) {
            cp = this.nextCode();
            const ecp = this.ESCAPES[cp];
            if (ecp) {
              out.push(ecp);
              cp = this.nextCode();
              continue;
            } else if (cp === 117) {
              const code = this.parseUnicode(4);
              out.push(code);
              cp = this.nextCode();
              continue;
            } else if (cp === 85) {
              const code = this.parseUnicode(8);
              out.push(code);
              cp = this.nextCode();
              continue;
            } else if (cp === 120 && this.tomlVersion.gte(1, 1)) {
              const code = this.parseUnicode(2);
              out.push(code);
              cp = this.nextCode();
              continue;
            } else if (cp === 10) {
              cp = this.nextCode();
              while ((0, code_point_1.isWhitespace)(cp) || cp === 10) {
                cp = this.nextCode();
              }
              continue;
            } else if ((0, code_point_1.isWhitespace)(cp)) {
              let valid = true;
              const startPos = this.codePointIterator.start;
              let nextCp;
              while ((nextCp = this.nextCode()) !== -1) {
                if (nextCp === 10) {
                  break;
                }
                if (!(0, code_point_1.isWhitespace)(nextCp)) {
                  this.moveAt(startPos);
                  valid = false;
                  break;
                }
              }
              if (valid) {
                cp = this.nextCode();
                while ((0, code_point_1.isWhitespace)(cp) || cp === 10) {
                  cp = this.nextCode();
                }
                continue;
              }
            }
            return this.reportParseError("invalid-char-in-escape-sequence");
          }
          out.push(cp);
          cp = this.nextCode();
        }
        return this.reportParseError("unterminated-string");
      }
      LITERAL_STRING(cp) {
        if (cp === 39) {
          cp = this.nextCode();
          if (cp === 39) {
            return "MULTI_LINE_LITERAL_STRING";
          }
          this.endToken("LiteralString", "start", "");
          return this.back("DATA");
        }
        const out = [];
        while (cp !== 39 && cp !== -1 && cp !== 10) {
          if (isControlOtherThanTab(cp)) {
            return this.reportParseErrorControlChar();
          }
          out.push(cp);
          cp = this.nextCode();
        }
        if (cp !== 39) {
          return this.reportParseError("unterminated-string");
        }
        this.endToken("LiteralString", "end", String.fromCodePoint(...out));
        return "DATA";
      }
      MULTI_LINE_LITERAL_STRING(cp) {
        const out = [];
        if (cp === 10) {
          cp = this.nextCode();
        }
        while (cp !== -1) {
          if (cp !== 10 && isControlOtherThanTab(cp)) {
            return this.reportParseErrorControlChar();
          }
          if (cp === 39) {
            const startPos = this.codePointIterator.start;
            if (this.eatCode(
              39
              /* CodePoint.SINGLE_QUOTE */
            ) && this.eatCode(
              39
              /* CodePoint.SINGLE_QUOTE */
            )) {
              if (this.eatCode(
                39
                /* CodePoint.SINGLE_QUOTE */
              )) {
                out.push(
                  39
                  /* CodePoint.SINGLE_QUOTE */
                );
                if (this.eatCode(
                  39
                  /* CodePoint.SINGLE_QUOTE */
                )) {
                  out.push(
                    39
                    /* CodePoint.SINGLE_QUOTE */
                  );
                  if (this.eatCode(
                    39
                    /* CodePoint.SINGLE_QUOTE */
                  )) {
                    this.moveAt(startPos);
                    return this.reportParseError("invalid-three-quotes");
                  }
                }
              }
              this.endToken("MultiLineLiteralString", "end", String.fromCodePoint(...out));
              return "DATA";
            }
            this.moveAt(startPos);
          }
          out.push(cp);
          cp = this.nextCode();
        }
        return this.reportParseError("unterminated-string");
      }
      SIGN(cp) {
        if (cp === 110 || cp === 105) {
          return this.back("NAN_OR_INF");
        }
        if ((0, code_point_1.isDigit)(cp)) {
          return this.back("NUMBER");
        }
        return this.reportParseError("unexpected-char");
      }
      NAN_OR_INF(cp) {
        if (cp === 110) {
          const startPos = this.codePointIterator.start;
          if (this.eatCode(
            97
            /* CodePoint.LATIN_SMALL_A */
          ) && this.eatCode(
            110
            /* CodePoint.LATIN_SMALL_N */
          )) {
            this.endToken("Float", "end", NaN);
            return "DATA";
          }
          this.moveAt(startPos);
        } else if (cp === 105) {
          const startPos = this.codePointIterator.start;
          if (this.eatCode(
            110
            /* CodePoint.LATIN_SMALL_N */
          ) && this.eatCode(
            102
            /* CodePoint.LATIN_SMALL_F */
          )) {
            this.endToken("Float", "end", this.text[this.tokenStart] === "-" ? -Infinity : Infinity);
            return "DATA";
          }
          this.moveAt(startPos);
        }
        return this.reportParseError("unexpected-char");
      }
      NUMBER(cp) {
        const start2 = this.text[this.tokenStart];
        const sign = start2 === "+" ? 43 : start2 === "-" ? 45 : 0;
        if (cp === 48) {
          if (sign === 0) {
            const startPos = this.codePointIterator.start;
            const nextCp2 = this.nextCode();
            if ((0, code_point_1.isDigit)(nextCp2)) {
              const nextNextCp = this.nextCode();
              if (nextNextCp === 58) {
                const data = {
                  hasDate: false,
                  year: 0,
                  month: 0,
                  day: 0,
                  hour: Number(String.fromCodePoint(48, nextCp2)),
                  minute: 0,
                  second: 0
                };
                this.data = data;
                return "TIME_MINUTE";
              }
              if ((0, code_point_1.isDigit)(nextNextCp)) {
                const nextNextNextCp = this.nextCode();
                if ((0, code_point_1.isDigit)(nextNextNextCp) && this.eatCode(
                  45
                  /* CodePoint.DASH */
                )) {
                  const data = {
                    hasDate: true,
                    year: Number(String.fromCodePoint(48, nextCp2, nextNextCp, nextNextNextCp)),
                    month: 0,
                    day: 0,
                    hour: 0,
                    minute: 0,
                    second: 0
                  };
                  this.data = data;
                  return "DATE_MONTH";
                }
              }
              this.moveAt(startPos);
              return this.reportParseError("invalid-leading-zero");
            }
            this.moveAt(startPos);
          }
          cp = this.nextCode();
          if (cp === 120 || cp === 111 || cp === 98) {
            if (sign !== 0) {
              return this.reportParseError("unexpected-char");
            }
            return cp === 120 ? "HEX" : cp === 111 ? "OCTAL" : "BINARY";
          }
          if (cp === 101 || cp === 69) {
            const data = {
              // Float values -0.0 and +0.0 are valid and should map according to IEEE 754.
              minus: sign === 45,
              left: [
                48
                /* CodePoint.DIGIT_0 */
              ]
            };
            this.data = data;
            return "EXPONENT_RIGHT";
          }
          if (cp === 46) {
            const data = {
              minus: sign === 45,
              absInt: [
                48
                /* CodePoint.DIGIT_0 */
              ]
            };
            this.data = data;
            return "FRACTIONAL_RIGHT";
          }
          this.endToken("Integer", "start", "0", 10);
          return this.back("DATA");
        }
        const { out, nextCp, hasUnderscore } = this.parseDigits(cp, code_point_1.isDigit);
        if (nextCp === 45 && sign === 0 && !hasUnderscore && out.length === 4) {
          const data = {
            hasDate: true,
            year: Number(String.fromCodePoint(...out)),
            month: 0,
            day: 0,
            hour: 0,
            minute: 0,
            second: 0
          };
          this.data = data;
          return "DATE_MONTH";
        }
        if (nextCp === 58 && sign === 0 && !hasUnderscore && out.length === 2) {
          const data = {
            hasDate: false,
            year: 0,
            month: 0,
            day: 0,
            hour: Number(String.fromCodePoint(...out)),
            minute: 0,
            second: 0
          };
          this.data = data;
          return "TIME_MINUTE";
        }
        if (nextCp === 101 || nextCp === 69) {
          const data = {
            minus: sign === 45,
            left: out
          };
          this.data = data;
          return "EXPONENT_RIGHT";
        }
        if (nextCp === 46) {
          const data = {
            minus: sign === 45,
            absInt: out
          };
          this.data = data;
          return "FRACTIONAL_RIGHT";
        }
        this.endToken("Integer", "start", sign === 45 ? String.fromCodePoint(45, ...out) : String.fromCodePoint(...out), 10);
        return this.back("DATA");
      }
      HEX(cp) {
        const { out } = this.parseDigits(cp, code_point_1.isHexDig);
        this.endToken("Integer", "start", String.fromCodePoint(...out), 16);
        return this.back("DATA");
      }
      OCTAL(cp) {
        const { out } = this.parseDigits(cp, code_point_1.isOctalDig);
        this.endToken("Integer", "start", String.fromCodePoint(...out), 8);
        return this.back("DATA");
      }
      BINARY(cp) {
        const { out } = this.parseDigits(
          cp,
          (c) => c === 48 || c === 49
          /* CodePoint.DIGIT_1 */
        );
        this.endToken("Integer", "start", String.fromCodePoint(...out), 2);
        return this.back("DATA");
      }
      FRACTIONAL_RIGHT(cp) {
        const { minus, absInt } = this.data;
        const { out, nextCp } = this.parseDigits(cp, code_point_1.isDigit);
        const absNum = [...absInt, 46, ...out];
        if (nextCp === 101 || nextCp === 69) {
          const data = {
            minus,
            left: absNum
          };
          this.data = data;
          return "EXPONENT_RIGHT";
        }
        const value = Number(minus ? String.fromCodePoint(45, ...absNum) : String.fromCodePoint(...absNum));
        this.endToken("Float", "start", value);
        return this.back("DATA");
      }
      EXPONENT_RIGHT(cp) {
        const { left, minus: leftMinus } = this.data;
        let minus = false;
        if (cp === 45 || cp === 43) {
          minus = cp === 45;
          cp = this.nextCode();
        }
        const { out } = this.parseDigits(cp, code_point_1.isDigit);
        const right = out;
        if (minus) {
          right.unshift(
            45
            /* CodePoint.DASH */
          );
        }
        const value = Number(leftMinus ? String.fromCodePoint(45, ...left, 101, ...right) : String.fromCodePoint(...left, 101, ...right));
        this.endToken("Float", "start", value);
        return this.back("DATA");
      }
      BOOLEAN(cp) {
        if (cp === 116) {
          const startPos = this.codePointIterator.start;
          if (this.eatCode(
            114
            /* CodePoint.LATIN_SMALL_R */
          ) && this.eatCode(
            117
            /* CodePoint.LATIN_SMALL_U */
          ) && this.eatCode(
            101
            /* CodePoint.LATIN_SMALL_E */
          )) {
            this.endToken("Boolean", "end", true);
            return "DATA";
          }
          this.moveAt(startPos);
        } else if (cp === 102) {
          const startPos = this.codePointIterator.start;
          if (this.eatCode(
            97
            /* CodePoint.LATIN_SMALL_A */
          ) && this.eatCode(
            108
            /* CodePoint.LATIN_SMALL_L */
          ) && this.eatCode(
            115
            /* CodePoint.LATIN_SMALL_S */
          ) && this.eatCode(
            101
            /* CodePoint.LATIN_SMALL_E */
          )) {
            this.endToken("Boolean", "end", false);
            return "DATA";
          }
          this.moveAt(startPos);
        }
        return this.reportParseError("unexpected-char");
      }
      DATE_MONTH(cp) {
        const start2 = this.codePointIterator.start;
        if (!(0, code_point_1.isDigit)(cp)) {
          return this.reportParseError("unexpected-char");
        }
        cp = this.nextCode();
        if (!(0, code_point_1.isDigit)(cp)) {
          return this.reportParseError("unexpected-char");
        }
        cp = this.nextCode();
        if (cp !== 45) {
          return this.reportParseError("unexpected-char");
        }
        const end = this.codePointIterator.start;
        const data = this.data;
        data.month = Number(this.text.slice(start2, end));
        return "DATE_DAY";
      }
      DATE_DAY(cp) {
        const start2 = this.codePointIterator.start;
        if (!(0, code_point_1.isDigit)(cp)) {
          return this.reportParseError("unexpected-char");
        }
        cp = this.nextCode();
        if (!(0, code_point_1.isDigit)(cp)) {
          return this.reportParseError("unexpected-char");
        }
        const end = this.codePointIterator.end;
        const data = this.data;
        data.day = Number(this.text.slice(start2, end));
        if (!isValidDate(data.year, data.month, data.day)) {
          return this.reportParseError("invalid-date");
        }
        cp = this.nextCode();
        if (cp === 84 || cp === 116) {
          return "TIME_HOUR";
        }
        if (cp === 32) {
          const startPos = this.codePointIterator.start;
          if ((0, code_point_1.isDigit)(this.nextCode()) && (0, code_point_1.isDigit)(this.nextCode())) {
            this.moveAt(startPos);
            return "TIME_HOUR";
          }
          this.moveAt(startPos);
        }
        const dateValue = getDateFromDateTimeData(data, "");
        this.endToken("LocalDate", "start", dateValue);
        return this.back("DATA");
      }
      TIME_HOUR(cp) {
        const start2 = this.codePointIterator.start;
        if (!(0, code_point_1.isDigit)(cp)) {
          return this.reportParseError("unexpected-char");
        }
        cp = this.nextCode();
        if (!(0, code_point_1.isDigit)(cp)) {
          return this.reportParseError("unexpected-char");
        }
        cp = this.nextCode();
        if (cp !== 58) {
          return this.reportParseError("unexpected-char");
        }
        const end = this.codePointIterator.start;
        const data = this.data;
        data.hour = Number(this.text.slice(start2, end));
        return "TIME_MINUTE";
      }
      TIME_MINUTE(cp) {
        const start2 = this.codePointIterator.start;
        if (!(0, code_point_1.isDigit)(cp)) {
          return this.reportParseError("unexpected-char");
        }
        cp = this.nextCode();
        if (!(0, code_point_1.isDigit)(cp)) {
          return this.reportParseError("unexpected-char");
        }
        const end = this.codePointIterator.end;
        const data = this.data;
        data.minute = Number(this.text.slice(start2, end));
        cp = this.nextCode();
        if (cp === 58) {
          return "TIME_SECOND";
        }
        if (this.tomlVersion.lt(1, 1)) {
          return this.reportParseError("unexpected-char");
        }
        if (!isValidTime(data.hour, data.minute, data.second)) {
          return this.reportParseError("invalid-time");
        }
        return this.processTimeEnd(cp, data);
      }
      TIME_SECOND(cp) {
        const start2 = this.codePointIterator.start;
        if (!(0, code_point_1.isDigit)(cp)) {
          return this.reportParseError("unexpected-char");
        }
        cp = this.nextCode();
        if (!(0, code_point_1.isDigit)(cp)) {
          return this.reportParseError("unexpected-char");
        }
        const end = this.codePointIterator.end;
        const data = this.data;
        data.second = Number(this.text.slice(start2, end));
        if (!isValidTime(data.hour, data.minute, data.second)) {
          return this.reportParseError("invalid-time");
        }
        cp = this.nextCode();
        if (cp === 46) {
          return "TIME_SEC_FRAC";
        }
        return this.processTimeEnd(cp, data);
      }
      TIME_SEC_FRAC(cp) {
        if (!(0, code_point_1.isDigit)(cp)) {
          return this.reportParseError("unexpected-char");
        }
        const start2 = this.codePointIterator.start;
        while ((0, code_point_1.isDigit)(cp)) {
          cp = this.nextCode();
        }
        const end = this.codePointIterator.start;
        const data = this.data;
        data.frac = this.text.slice(start2, end);
        return this.processTimeEnd(cp, data);
      }
      processTimeEnd(cp, data) {
        if (data.hasDate) {
          if (cp === 45 || cp === 43) {
            data.offsetSign = cp;
            return "TIME_OFFSET";
          }
          if (cp === 90 || cp === 122) {
            const dateValue3 = getDateFromDateTimeData(data, "Z");
            this.endToken("OffsetDateTime", "end", dateValue3);
            return "DATA";
          }
          const dateValue2 = getDateFromDateTimeData(data, "");
          this.endToken("LocalDateTime", "start", dateValue2);
          return this.back("DATA");
        }
        const dateValue = getDateFromDateTimeData(data, "");
        this.endToken("LocalTime", "start", dateValue);
        return this.back("DATA");
      }
      TIME_OFFSET(cp) {
        if (!(0, code_point_1.isDigit)(cp)) {
          return this.reportParseError("unexpected-char");
        }
        const hourStart = this.codePointIterator.start;
        cp = this.nextCode();
        if (!(0, code_point_1.isDigit)(cp)) {
          return this.reportParseError("unexpected-char");
        }
        cp = this.nextCode();
        if (cp !== 58) {
          return this.reportParseError("unexpected-char");
        }
        const hourEnd = this.codePointIterator.start;
        cp = this.nextCode();
        const minuteStart = this.codePointIterator.start;
        if (!(0, code_point_1.isDigit)(cp)) {
          return this.reportParseError("unexpected-char");
        }
        cp = this.nextCode();
        if (!(0, code_point_1.isDigit)(cp)) {
          return this.reportParseError("unexpected-char");
        }
        const minuteEnd = this.codePointIterator.end;
        const hour = Number(this.text.slice(hourStart, hourEnd));
        const minute = Number(this.text.slice(minuteStart, minuteEnd));
        if (!isValidTime(hour, minute, 0)) {
          return this.reportParseError("invalid-time");
        }
        const data = this.data;
        const dateValue = getDateFromDateTimeData(data, `${String.fromCodePoint(data.offsetSign)}${padStart(hour, 2)}:${padStart(minute, 2)}`);
        this.endToken("OffsetDateTime", "end", dateValue);
        return "DATA";
      }
      parseDigits(cp, checkDigit) {
        if (cp === 95) {
          return this.reportParseError("invalid-underscore");
        }
        if (!checkDigit(cp)) {
          return this.reportParseError("unexpected-char");
        }
        const out = [];
        let before = 0;
        let hasUnderscore = false;
        while (checkDigit(cp) || cp === 95) {
          if (cp === 95) {
            hasUnderscore = true;
            if (before === 95) {
              return this.reportParseError("invalid-underscore");
            }
          } else {
            out.push(cp);
          }
          before = cp;
          cp = this.nextCode();
        }
        if (before === 95) {
          return this.reportParseError("invalid-underscore");
        }
        return {
          out,
          nextCp: cp,
          hasUnderscore
        };
      }
      parseUnicode(count) {
        const startLoc = this.codePointIterator.start;
        const start2 = this.codePointIterator.end;
        let charCount = 0;
        let cp;
        while ((cp = this.nextCode()) !== -1) {
          if (!(0, code_point_1.isHexDig)(cp)) {
            this.moveAt(startLoc);
            return this.reportParseError("invalid-char-in-escape-sequence");
          }
          charCount++;
          if (charCount >= count) {
            break;
          }
        }
        const end = this.codePointIterator.end;
        const code = this.text.slice(start2, end);
        const codePoint = parseInt(code, 16);
        if (!(0, code_point_1.isUnicodeScalarValue)(codePoint)) {
          return this.reportParseError("invalid-code-point", { cp: code });
        }
        return codePoint;
      }
      reportParseErrorControlChar() {
        return this.reportParseError("invalid-control-character");
      }
    };
    exports2.Tokenizer = Tokenizer;
    function isUnquotedKeyChar(cp, tomlVersion) {
      if ((0, code_point_1.isLetter)(cp) || (0, code_point_1.isDigit)(cp) || cp === 95 || cp === 45) {
        return true;
      }
      if (tomlVersion.lt(1, 1)) {
        return false;
      }
      if (cp === 178 || cp === 179 || cp === 185 || 188 <= cp && cp <= 190) {
        return true;
      }
      if (192 <= cp && cp <= 214 || 216 <= cp && cp <= 246 || 248 <= cp && cp <= 891) {
        return true;
      }
      if (895 <= cp && cp <= 8191) {
        return true;
      }
      if (8204 <= cp && cp <= 8205 || 8255 <= cp && cp <= 8256) {
        return true;
      }
      if (8304 <= cp && cp <= 8591 || 9312 <= cp && cp <= 9471) {
        return true;
      }
      if (11264 <= cp && cp <= 12271 || 12289 <= cp && cp <= 55295) {
        return true;
      }
      if (63744 <= cp && cp <= 64975 || 65008 <= cp && cp <= 65533) {
        return true;
      }
      if (65536 <= cp && cp <= 983039) {
        return true;
      }
      return false;
    }
    function isControlOtherThanTab(cp) {
      return (0, code_point_1.isControl)(cp) && cp !== 9 || cp === 127;
    }
    function isAllowedCommentCharacter(cp) {
      return 1 <= cp && cp <= 9 || 14 <= cp && cp <= 127 || isNonAscii(cp);
    }
    function isNonAscii(cp) {
      return 128 <= cp && cp <= 55295 || 57344 <= cp && cp <= 1114111;
    }
    function isValidDate(y, m, d) {
      if (y >= 0 && m <= 12 && m >= 1 && d >= 1) {
        const maxDayOfMonth = m === 2 ? y & 3 || !(y % 25) && y & 15 ? 28 : 29 : 30 + (m + (m >> 3) & 1);
        return d <= maxDayOfMonth;
      }
      return false;
    }
    function isValidTime(h, m, s) {
      if (h >= 24 || h < 0 || m > 59 || m < 0 || s > 60 || s < 0) {
        return false;
      }
      return true;
    }
    function getDateFromDateTimeData(data, timeZone) {
      const year = padStart(data.year, 4);
      const month = data.month ? padStart(data.month, 2) : "01";
      const day = data.day ? padStart(data.day, 2) : "01";
      const hour = padStart(data.hour, 2);
      const minute = padStart(data.minute, 2);
      const second = padStart(data.second, 2);
      const textDate = `${year}-${month}-${day}`;
      const frac = data.frac ? `.${data.frac}` : "";
      const dateValue = /* @__PURE__ */ new Date(`${textDate}T${hour}:${minute}:${second}${frac}${timeZone}`);
      if (!isNaN(dateValue.getTime()) || data.second !== 60) {
        return dateValue;
      }
      return /* @__PURE__ */ new Date(`${textDate}T${hour}:${minute}:59${frac}${timeZone}`);
    }
    function padStart(num, maxLength) {
      return String(num).padStart(maxLength, "0");
    }
  }
});

// node_modules/.pnpm/toml-eslint-parser@0.10.0/node_modules/toml-eslint-parser/lib/tokenizer/index.js
var require_tokenizer2 = __commonJS({
  "node_modules/.pnpm/toml-eslint-parser@0.10.0/node_modules/toml-eslint-parser/lib/tokenizer/index.js"(exports2) {
    "use strict";
    var __createBinding = exports2 && exports2.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __exportStar = exports2 && exports2.__exportStar || function(m, exports3) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports3, p)) __createBinding(exports3, m, p);
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    __exportStar(require_tokenizer(), exports2);
  }
});

// node_modules/.pnpm/toml-eslint-parser@0.10.0/node_modules/toml-eslint-parser/lib/toml-parser/keys-resolver.js
var require_keys_resolver = __commonJS({
  "node_modules/.pnpm/toml-eslint-parser@0.10.0/node_modules/toml-eslint-parser/lib/toml-parser/keys-resolver.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.KeysResolver = void 0;
    var internal_utils_1 = require_internal_utils();
    var KeysResolver = class {
      constructor(ctx) {
        this.rootKeys = /* @__PURE__ */ new Map();
        this.tables = [];
        this.ctx = ctx;
      }
      applyResolveKeyForTable(node) {
        let keys = this.rootKeys;
        const peekKeyIndex = node.key.keys.length - 1;
        for (let index = 0; index < peekKeyIndex; index++) {
          const keyNode = node.key.keys[index];
          const keyName = (0, internal_utils_1.toKeyName)(keyNode);
          node.resolvedKey.push(keyName);
          let keyStore = keys.get(keyName);
          if (!keyStore) {
            keyStore = { node: keyNode, keys: /* @__PURE__ */ new Map() };
            keys.set(keyName, keyStore);
          } else if (keyStore.table === "array") {
            const peekIndex = keyStore.peekIndex;
            node.resolvedKey.push(peekIndex);
            keyStore = keyStore.keys.get(peekIndex);
          }
          keys = keyStore.keys;
        }
        const lastKeyNode = node.key.keys[peekKeyIndex];
        const lastKeyName = (0, internal_utils_1.toKeyName)(lastKeyNode);
        node.resolvedKey.push(lastKeyName);
        const lastKeyStore = keys.get(lastKeyName);
        if (!lastKeyStore) {
          if (node.kind === "array") {
            node.resolvedKey.push(0);
            const newKeyStore = {
              node: lastKeyNode,
              keys: /* @__PURE__ */ new Map()
            };
            keys.set(lastKeyName, {
              table: node.kind,
              node: lastKeyNode,
              keys: /* @__PURE__ */ new Map([[0, newKeyStore]]),
              peekIndex: 0
            });
            this.tables.push({ node, keys: newKeyStore.keys });
          } else {
            const newKeyStore = {
              table: node.kind,
              node: lastKeyNode,
              keys: /* @__PURE__ */ new Map()
            };
            keys.set(lastKeyName, newKeyStore);
            this.tables.push({ node, keys: newKeyStore.keys });
          }
        } else if (!lastKeyStore.table) {
          if (node.kind === "array") {
            this.ctx.reportParseError("dupe-keys", lastKeyNode);
          } else {
            const transformKey = {
              table: node.kind,
              node: lastKeyNode,
              keys: lastKeyStore.keys
            };
            keys.set(lastKeyName, transformKey);
            this.tables.push({ node, keys: transformKey.keys });
          }
        } else if (lastKeyStore.table === "array") {
          if (node.kind === "array") {
            const newKeyStore = {
              node: lastKeyNode,
              keys: /* @__PURE__ */ new Map()
            };
            const newIndex = lastKeyStore.peekIndex + 1;
            node.resolvedKey.push(newIndex);
            lastKeyStore.keys.set(newIndex, newKeyStore);
            lastKeyStore.peekIndex = newIndex;
            this.tables.push({ node, keys: newKeyStore.keys });
          } else {
            this.ctx.reportParseError("dupe-keys", lastKeyNode);
          }
        } else {
          this.ctx.reportParseError("dupe-keys", lastKeyNode);
        }
      }
      verifyDuplicateKeys(node) {
        for (const body of node.body) {
          if (body.type === "TOMLKeyValue") {
            verifyDuplicateKeysForKeyValue(this.ctx, this.rootKeys, body);
          }
        }
        for (const { node: tableNode, keys } of this.tables) {
          for (const body of tableNode.body) {
            verifyDuplicateKeysForKeyValue(this.ctx, keys, body);
          }
        }
      }
    };
    exports2.KeysResolver = KeysResolver;
    function verifyDuplicateKeysForKeyValue(ctx, defineKeys, node) {
      let keys = defineKeys;
      const lastKey = (0, internal_utils_1.last)(node.key.keys);
      for (const keyNode of node.key.keys) {
        const key = (0, internal_utils_1.toKeyName)(keyNode);
        let defineKey = keys.get(key);
        if (defineKey) {
          if (defineKey.value === 0) {
            ctx.reportParseError("dupe-keys", getAfterNode(keyNode, defineKey.node));
          } else if (lastKey === keyNode) {
            ctx.reportParseError("dupe-keys", getAfterNode(keyNode, defineKey.node));
          } else if (defineKey.table) {
            ctx.reportParseError("dupe-keys", getAfterNode(keyNode, defineKey.node));
          }
          defineKey.value = 1;
        } else {
          if (lastKey === keyNode) {
            const keyStore = {
              value: 0,
              node: keyNode,
              keys: /* @__PURE__ */ new Map()
            };
            defineKey = keyStore;
          } else {
            const keyStore = {
              value: 1,
              node: keyNode,
              keys: /* @__PURE__ */ new Map()
            };
            defineKey = keyStore;
          }
          keys.set(key, defineKey);
        }
        keys = defineKey.keys;
      }
      if (node.value.type === "TOMLInlineTable") {
        verifyDuplicateKeysForInlineTable(ctx, keys, node.value);
      } else if (node.value.type === "TOMLArray") {
        verifyDuplicateKeysForArray(ctx, keys, node.value);
      }
    }
    function verifyDuplicateKeysForInlineTable(ctx, defineKeys, node) {
      for (const body of node.body) {
        verifyDuplicateKeysForKeyValue(ctx, defineKeys, body);
      }
    }
    function verifyDuplicateKeysForArray(ctx, defineKeys, node) {
      const keys = defineKeys;
      for (let index = 0; index < node.elements.length; index++) {
        const element = node.elements[index];
        let defineKey = keys.get(index);
        if (defineKey) {
          ctx.reportParseError("dupe-keys", getAfterNode(element, defineKey.node));
        } else {
          defineKey = {
            value: 0,
            node: element,
            keys: /* @__PURE__ */ new Map()
          };
          defineKeys.set(index, defineKey);
          if (element.type === "TOMLInlineTable") {
            verifyDuplicateKeysForInlineTable(ctx, defineKey.keys, element);
          } else if (element.type === "TOMLArray") {
            verifyDuplicateKeysForArray(ctx, defineKey.keys, element);
          }
        }
      }
    }
    function getAfterNode(a, b) {
      return a.range[0] <= b.range[0] ? b : a;
    }
  }
});

// node_modules/.pnpm/toml-eslint-parser@0.10.0/node_modules/toml-eslint-parser/lib/toml-parser/context.js
var require_context = __commonJS({
  "node_modules/.pnpm/toml-eslint-parser@0.10.0/node_modules/toml-eslint-parser/lib/toml-parser/context.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.Context = void 0;
    var errors_1 = require_errors();
    var tokenizer_1 = require_tokenizer2();
    var keys_resolver_1 = require_keys_resolver();
    var Context = class {
      constructor(data) {
        this.tokens = [];
        this.comments = [];
        this.back = null;
        this.stateStack = [];
        this.needNewLine = false;
        this.needSameLine = false;
        this.currToken = null;
        this.prevToken = null;
        this.valueContainerStack = [];
        this.tokenizer = new tokenizer_1.Tokenizer(data.text, data.parserOptions);
        this.topLevelTable = data.topLevelTable;
        this.table = data.topLevelTable;
        this.keysResolver = new keys_resolver_1.KeysResolver(this);
      }
      get startPos() {
        return this.tokenizer.positions.start;
      }
      get endPos() {
        return this.tokenizer.positions.end;
      }
      /**
       * Get the next token.
       */
      nextToken(option) {
        this.prevToken = this.currToken;
        if (this.back) {
          this.currToken = this.back;
          this.back = null;
        } else {
          this.currToken = this._nextTokenFromTokenizer(option);
        }
        if ((this.needNewLine || this.needSameLine || (option === null || option === void 0 ? void 0 : option.needSameLine)) && this.prevToken && this.currToken) {
          if (this.prevToken.loc.end.line === this.currToken.loc.start.line) {
            if (this.needNewLine) {
              return this.reportParseError("missing-newline", this.currToken);
            }
          } else {
            const needSameLine = this.needSameLine || (option === null || option === void 0 ? void 0 : option.needSameLine);
            if (needSameLine) {
              return this.reportParseError(needSameLine, this.currToken);
            }
          }
        }
        this.needNewLine = false;
        this.needSameLine = false;
        return this.currToken;
      }
      _nextTokenFromTokenizer(option) {
        const valuesEnabled = this.tokenizer.valuesEnabled;
        if (option === null || option === void 0 ? void 0 : option.valuesEnabled) {
          this.tokenizer.valuesEnabled = option.valuesEnabled;
        }
        let token = this.tokenizer.nextToken();
        while (token && token.type === "Block") {
          this.comments.push(token);
          token = this.tokenizer.nextToken();
        }
        if (token) {
          this.tokens.push(token);
        }
        this.tokenizer.valuesEnabled = valuesEnabled;
        return token;
      }
      backToken() {
        if (this.back) {
          throw new Error("Illegal state");
        }
        this.back = this.currToken;
        this.currToken = this.prevToken;
      }
      addValueContainer(valueContainer) {
        this.valueContainerStack.push(valueContainer);
        this.tokenizer.valuesEnabled = true;
      }
      consumeValueContainer() {
        const valueContainer = this.valueContainerStack.pop();
        this.tokenizer.valuesEnabled = this.valueContainerStack.length > 0;
        return valueContainer;
      }
      applyResolveKeyForTable(node) {
        this.keysResolver.applyResolveKeyForTable(node);
      }
      verifyDuplicateKeys() {
        this.keysResolver.verifyDuplicateKeys(this.topLevelTable);
      }
      /**
       * Report an invalid token error.
       */
      reportParseError(code, token) {
        let offset, line, column;
        if (token) {
          offset = token.range[0];
          line = token.loc.start.line;
          column = token.loc.start.column;
        } else {
          const startPos = this.startPos;
          offset = startPos.offset;
          line = startPos.line;
          column = startPos.column;
        }
        throw new errors_1.ParseError(code, offset, line, column);
      }
    };
    exports2.Context = Context;
  }
});

// node_modules/.pnpm/toml-eslint-parser@0.10.0/node_modules/toml-eslint-parser/lib/toml-parser/index.js
var require_toml_parser = __commonJS({
  "node_modules/.pnpm/toml-eslint-parser@0.10.0/node_modules/toml-eslint-parser/lib/toml-parser/index.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.TOMLParser = void 0;
    var internal_utils_1 = require_internal_utils();
    var parser_options_1 = require_parser_options();
    var context_1 = require_context();
    var STATE_FOR_ERROR = {
      VALUE: "missing-value"
    };
    var STRING_VALUE_STYLE_MAP = {
      BasicString: "basic",
      MultiLineBasicString: "basic",
      LiteralString: "literal",
      MultiLineLiteralString: "literal"
    };
    var STRING_KEY_STYLE_MAP = {
      BasicString: "basic",
      LiteralString: "literal"
    };
    var DATETIME_VALUE_KIND_MAP = {
      OffsetDateTime: "offset-date-time",
      LocalDateTime: "local-date-time",
      LocalDate: "local-date",
      LocalTime: "local-time"
    };
    var TOMLParser = class {
      /**
       * Initialize this parser.
       */
      constructor(text2, parserOptions) {
        this.text = text2;
        this.parserOptions = parserOptions || {};
        this.tomlVersion = (0, parser_options_1.getTOMLVer)(this.parserOptions.tomlVersion);
      }
      /**
       * Parse TOML
       */
      parse() {
        const ast = {
          type: "Program",
          body: [],
          sourceType: "module",
          tokens: [],
          comments: [],
          parent: null,
          range: [0, 0],
          loc: {
            start: {
              line: 1,
              column: 0
            },
            end: {
              line: 1,
              column: 0
            }
          }
        };
        const node = {
          type: "TOMLTopLevelTable",
          body: [],
          parent: ast,
          range: cloneRange(ast.range),
          loc: cloneLoc(ast.loc)
        };
        ast.body = [node];
        const ctx = new context_1.Context({
          text: this.text,
          parserOptions: this.parserOptions,
          topLevelTable: node
        });
        let token = ctx.nextToken();
        if (token) {
          node.range[0] = token.range[0];
          node.loc.start = clonePos(token.loc.start);
          while (token) {
            const state2 = ctx.stateStack.pop() || "TABLE";
            ctx.stateStack.push(...this[state2](token, ctx));
            token = ctx.nextToken();
          }
          const state = ctx.stateStack.pop() || "TABLE";
          if (state in STATE_FOR_ERROR) {
            return ctx.reportParseError(STATE_FOR_ERROR[state], null);
          }
          if (ctx.table.type === "TOMLTable") {
            applyEndLoc(ctx.table, (0, internal_utils_1.last)(ctx.table.body));
          }
          applyEndLoc(node, (0, internal_utils_1.last)(node.body));
        }
        ctx.verifyDuplicateKeys();
        ast.tokens = ctx.tokens;
        ast.comments = ctx.comments;
        const endPos = ctx.endPos;
        ast.range[1] = endPos.offset;
        ast.loc.end = {
          line: endPos.line,
          column: endPos.column
        };
        return ast;
      }
      TABLE(token, ctx) {
        if (isBare(token) || isString2(token)) {
          return this.processKeyValue(token, ctx.table, ctx);
        }
        if (isLeftBracket(token)) {
          return this.processTable(token, ctx.topLevelTable, ctx);
        }
        return ctx.reportParseError("unexpected-token", token);
      }
      VALUE(token, ctx) {
        if (isString2(token) || isMultiLineString(token)) {
          return this.processStringValue(token, ctx);
        }
        if (isNumber2(token)) {
          return this.processNumberValue(token, ctx);
        }
        if (isBoolean(token)) {
          return this.processBooleanValue(token, ctx);
        }
        if (isDateTime(token)) {
          return this.processDateTimeValue(token, ctx);
        }
        if (isLeftBracket(token)) {
          return this.processArray(token, ctx);
        }
        if (isLeftBrace(token)) {
          return this.processInlineTable(token, ctx);
        }
        return ctx.reportParseError("unexpected-token", token);
      }
      processTable(token, topLevelTableNode, ctx) {
        const tableNode = {
          type: "TOMLTable",
          kind: "standard",
          key: null,
          resolvedKey: [],
          body: [],
          parent: topLevelTableNode,
          range: cloneRange(token.range),
          loc: cloneLoc(token.loc)
        };
        if (ctx.table.type === "TOMLTable") {
          applyEndLoc(ctx.table, (0, internal_utils_1.last)(ctx.table.body));
        }
        topLevelTableNode.body.push(tableNode);
        ctx.table = tableNode;
        let targetToken = ctx.nextToken({
          needSameLine: "invalid-key-value-newline"
        });
        if (isLeftBracket(targetToken)) {
          if (token.range[1] < targetToken.range[0]) {
            return ctx.reportParseError("invalid-space", targetToken);
          }
          tableNode.kind = "array";
          targetToken = ctx.nextToken({
            needSameLine: "invalid-key-value-newline"
          });
        }
        if (isRightBracket(targetToken)) {
          return ctx.reportParseError("missing-key", targetToken);
        }
        if (!targetToken) {
          return ctx.reportParseError("unterminated-table-key", null);
        }
        const keyNodeData = this.processKeyNode(targetToken, tableNode, ctx);
        targetToken = keyNodeData.nextToken;
        if (!isRightBracket(targetToken)) {
          return ctx.reportParseError("unterminated-table-key", targetToken);
        }
        if (tableNode.kind === "array") {
          const rightBracket = targetToken;
          targetToken = ctx.nextToken({
            needSameLine: "invalid-key-value-newline"
          });
          if (!isRightBracket(targetToken)) {
            return ctx.reportParseError("unterminated-table-key", targetToken);
          }
          if (rightBracket.range[1] < targetToken.range[0]) {
            return ctx.reportParseError("invalid-space", targetToken);
          }
        }
        applyEndLoc(tableNode, targetToken);
        ctx.applyResolveKeyForTable(tableNode);
        ctx.needNewLine = true;
        return [];
      }
      processKeyValue(token, tableNode, ctx) {
        const keyValueNode = {
          type: "TOMLKeyValue",
          key: null,
          value: null,
          parent: tableNode,
          range: cloneRange(token.range),
          loc: cloneLoc(token.loc)
        };
        tableNode.body.push(keyValueNode);
        const { nextToken: targetToken } = this.processKeyNode(token, keyValueNode, ctx);
        if (!isEq(targetToken)) {
          return ctx.reportParseError("missing-equals-sign", targetToken);
        }
        ctx.addValueContainer({
          parent: keyValueNode,
          set: (valNode) => {
            keyValueNode.value = valNode;
            applyEndLoc(keyValueNode, valNode);
            ctx.needNewLine = true;
            return [];
          }
        });
        ctx.needSameLine = "invalid-key-value-newline";
        return ["VALUE"];
      }
      processKeyNode(token, parent, ctx) {
        const keyNode = {
          type: "TOMLKey",
          keys: [],
          parent,
          range: cloneRange(token.range),
          loc: cloneLoc(token.loc)
        };
        parent.key = keyNode;
        let targetToken = token;
        while (targetToken) {
          if (isBare(targetToken)) {
            this.processBareKey(targetToken, keyNode);
          } else if (isString2(targetToken)) {
            this.processStringKey(targetToken, keyNode);
          } else {
            break;
          }
          targetToken = ctx.nextToken({
            needSameLine: "invalid-key-value-newline"
          });
          if (isDot(targetToken)) {
            targetToken = ctx.nextToken({
              needSameLine: "invalid-key-value-newline"
            });
          } else {
            break;
          }
        }
        applyEndLoc(keyNode, (0, internal_utils_1.last)(keyNode.keys));
        return { keyNode, nextToken: targetToken };
      }
      processBareKey(token, keyNode) {
        const node = {
          type: "TOMLBare",
          name: token.value,
          parent: keyNode,
          range: cloneRange(token.range),
          loc: cloneLoc(token.loc)
        };
        keyNode.keys.push(node);
      }
      processStringKey(token, keyNode) {
        const node = {
          type: "TOMLQuoted",
          kind: "string",
          value: token.string,
          style: STRING_KEY_STYLE_MAP[token.type],
          multiline: false,
          parent: keyNode,
          range: cloneRange(token.range),
          loc: cloneLoc(token.loc)
        };
        keyNode.keys.push(node);
      }
      processStringValue(token, ctx) {
        const valueContainer = ctx.consumeValueContainer();
        const node = {
          type: "TOMLValue",
          kind: "string",
          value: token.string,
          style: STRING_VALUE_STYLE_MAP[token.type],
          multiline: isMultiLineString(token),
          parent: valueContainer.parent,
          range: cloneRange(token.range),
          loc: cloneLoc(token.loc)
        };
        return valueContainer.set(node);
      }
      processNumberValue(token, ctx) {
        const valueContainer = ctx.consumeValueContainer();
        const text2 = this.text;
        const [startRange, endRange] = token.range;
        let numberString = null;
        const getNumberText = () => {
          return numberString !== null && numberString !== void 0 ? numberString : numberString = text2.slice(startRange, endRange).replace(/_/g, "");
        };
        let node;
        if (token.type === "Integer") {
          node = {
            type: "TOMLValue",
            kind: "integer",
            value: token.number,
            bigint: token.bigint,
            get number() {
              return getNumberText();
            },
            parent: valueContainer.parent,
            range: cloneRange(token.range),
            loc: cloneLoc(token.loc)
          };
        } else {
          node = {
            type: "TOMLValue",
            kind: "float",
            value: token.number,
            get number() {
              return getNumberText();
            },
            parent: valueContainer.parent,
            range: cloneRange(token.range),
            loc: cloneLoc(token.loc)
          };
        }
        return valueContainer.set(node);
      }
      processBooleanValue(token, ctx) {
        const valueContainer = ctx.consumeValueContainer();
        const node = {
          type: "TOMLValue",
          kind: "boolean",
          value: token.boolean,
          parent: valueContainer.parent,
          range: cloneRange(token.range),
          loc: cloneLoc(token.loc)
        };
        return valueContainer.set(node);
      }
      processDateTimeValue(token, ctx) {
        const valueContainer = ctx.consumeValueContainer();
        const node = {
          type: "TOMLValue",
          kind: DATETIME_VALUE_KIND_MAP[token.type],
          value: token.date,
          datetime: token.value,
          parent: valueContainer.parent,
          range: cloneRange(token.range),
          loc: cloneLoc(token.loc)
        };
        return valueContainer.set(node);
      }
      processArray(token, ctx) {
        const valueContainer = ctx.consumeValueContainer();
        const node = {
          type: "TOMLArray",
          elements: [],
          parent: valueContainer.parent,
          range: cloneRange(token.range),
          loc: cloneLoc(token.loc)
        };
        const nextToken = ctx.nextToken({ valuesEnabled: true });
        if (isRightBracket(nextToken)) {
          applyEndLoc(node, nextToken);
          return valueContainer.set(node);
        }
        ctx.backToken();
        return this.processArrayValue(node, valueContainer, ctx);
      }
      processArrayValue(node, valueContainer, ctx) {
        ctx.addValueContainer({
          parent: node,
          set: (valNode) => {
            node.elements.push(valNode);
            let nextToken = ctx.nextToken({ valuesEnabled: true });
            const hasComma = isComma(nextToken);
            if (hasComma) {
              nextToken = ctx.nextToken({ valuesEnabled: true });
            }
            if (isRightBracket(nextToken)) {
              applyEndLoc(node, nextToken);
              return valueContainer.set(node);
            }
            if (hasComma) {
              ctx.backToken();
              return this.processArrayValue(node, valueContainer, ctx);
            }
            return ctx.reportParseError(nextToken ? "missing-comma" : "unterminated-array", nextToken);
          }
        });
        return ["VALUE"];
      }
      processInlineTable(token, ctx) {
        const valueContainer = ctx.consumeValueContainer();
        const node = {
          type: "TOMLInlineTable",
          body: [],
          parent: valueContainer.parent,
          range: cloneRange(token.range),
          loc: cloneLoc(token.loc)
        };
        const needSameLine = this.tomlVersion.gte(1, 1) ? (
          // Line breaks in inline tables are allowed.
          // Added in TOML 1.1
          void 0
        ) : "invalid-inline-table-newline";
        const nextToken = ctx.nextToken({
          needSameLine
        });
        if (nextToken) {
          if (isBare(nextToken) || isString2(nextToken)) {
            return this.processInlineTableKeyValue(nextToken, node, valueContainer, ctx);
          }
          if (isRightBrace(nextToken)) {
            applyEndLoc(node, nextToken);
            return valueContainer.set(node);
          }
        }
        return ctx.reportParseError("unexpected-token", nextToken);
      }
      processInlineTableKeyValue(token, inlineTableNode, valueContainer, ctx) {
        const keyValueNode = {
          type: "TOMLKeyValue",
          key: null,
          value: null,
          parent: inlineTableNode,
          range: cloneRange(token.range),
          loc: cloneLoc(token.loc)
        };
        inlineTableNode.body.push(keyValueNode);
        const { nextToken: targetToken } = this.processKeyNode(token, keyValueNode, ctx);
        if (!isEq(targetToken)) {
          return ctx.reportParseError("missing-equals-sign", targetToken);
        }
        const needSameLine = this.tomlVersion.gte(1, 1) ? (
          // Line breaks in inline tables are allowed.
          // Added in TOML 1.1
          void 0
        ) : "invalid-inline-table-newline";
        ctx.addValueContainer({
          parent: keyValueNode,
          set: (valNode) => {
            keyValueNode.value = valNode;
            applyEndLoc(keyValueNode, valNode);
            let nextToken = ctx.nextToken({ needSameLine });
            if (isComma(nextToken)) {
              nextToken = ctx.nextToken({ needSameLine });
              if (nextToken && (isBare(nextToken) || isString2(nextToken))) {
                return this.processInlineTableKeyValue(nextToken, inlineTableNode, valueContainer, ctx);
              }
              if (isRightBrace(nextToken)) {
                if (this.tomlVersion.lt(1, 1)) {
                  return ctx.reportParseError("invalid-trailing-comma-in-inline-table", nextToken);
                }
              } else {
                return ctx.reportParseError(nextToken ? "unexpected-token" : "unterminated-inline-table", nextToken);
              }
            }
            if (isRightBrace(nextToken)) {
              applyEndLoc(inlineTableNode, nextToken);
              return valueContainer.set(inlineTableNode);
            }
            return ctx.reportParseError(nextToken ? "missing-comma" : "unterminated-inline-table", nextToken);
          }
        });
        ctx.needSameLine = "invalid-key-value-newline";
        return ["VALUE"];
      }
    };
    exports2.TOMLParser = TOMLParser;
    function isDot(token) {
      return isPunctuator(token) && token.value === ".";
    }
    function isEq(token) {
      return isPunctuator(token) && token.value === "=";
    }
    function isLeftBracket(token) {
      return isPunctuator(token) && token.value === "[";
    }
    function isRightBracket(token) {
      return isPunctuator(token) && token.value === "]";
    }
    function isLeftBrace(token) {
      return isPunctuator(token) && token.value === "{";
    }
    function isRightBrace(token) {
      return isPunctuator(token) && token.value === "}";
    }
    function isComma(token) {
      return isPunctuator(token) && token.value === ",";
    }
    function isPunctuator(token) {
      return Boolean(token && token.type === "Punctuator");
    }
    function isBare(token) {
      return token.type === "Bare";
    }
    function isString2(token) {
      return token.type === "BasicString" || token.type === "LiteralString";
    }
    function isMultiLineString(token) {
      return token.type === "MultiLineBasicString" || token.type === "MultiLineLiteralString";
    }
    function isNumber2(token) {
      return token.type === "Integer" || token.type === "Float";
    }
    function isBoolean(token) {
      return token.type === "Boolean";
    }
    function isDateTime(token) {
      return token.type === "OffsetDateTime" || token.type === "LocalDateTime" || token.type === "LocalDate" || token.type === "LocalTime";
    }
    function applyEndLoc(node, child2) {
      if (child2) {
        node.range[1] = child2.range[1];
        node.loc.end = clonePos(child2.loc.end);
      }
    }
    function cloneRange(range) {
      return [range[0], range[1]];
    }
    function cloneLoc(loc) {
      return {
        start: clonePos(loc.start),
        end: clonePos(loc.end)
      };
    }
    function clonePos(pos) {
      return {
        line: pos.line,
        column: pos.column
      };
    }
  }
});

// node_modules/.pnpm/eslint-visitor-keys@3.4.3/node_modules/eslint-visitor-keys/dist/eslint-visitor-keys.cjs
var require_eslint_visitor_keys = __commonJS({
  "node_modules/.pnpm/eslint-visitor-keys@3.4.3/node_modules/eslint-visitor-keys/dist/eslint-visitor-keys.cjs"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var KEYS = {
      ArrayExpression: [
        "elements"
      ],
      ArrayPattern: [
        "elements"
      ],
      ArrowFunctionExpression: [
        "params",
        "body"
      ],
      AssignmentExpression: [
        "left",
        "right"
      ],
      AssignmentPattern: [
        "left",
        "right"
      ],
      AwaitExpression: [
        "argument"
      ],
      BinaryExpression: [
        "left",
        "right"
      ],
      BlockStatement: [
        "body"
      ],
      BreakStatement: [
        "label"
      ],
      CallExpression: [
        "callee",
        "arguments"
      ],
      CatchClause: [
        "param",
        "body"
      ],
      ChainExpression: [
        "expression"
      ],
      ClassBody: [
        "body"
      ],
      ClassDeclaration: [
        "id",
        "superClass",
        "body"
      ],
      ClassExpression: [
        "id",
        "superClass",
        "body"
      ],
      ConditionalExpression: [
        "test",
        "consequent",
        "alternate"
      ],
      ContinueStatement: [
        "label"
      ],
      DebuggerStatement: [],
      DoWhileStatement: [
        "body",
        "test"
      ],
      EmptyStatement: [],
      ExperimentalRestProperty: [
        "argument"
      ],
      ExperimentalSpreadProperty: [
        "argument"
      ],
      ExportAllDeclaration: [
        "exported",
        "source"
      ],
      ExportDefaultDeclaration: [
        "declaration"
      ],
      ExportNamedDeclaration: [
        "declaration",
        "specifiers",
        "source"
      ],
      ExportSpecifier: [
        "exported",
        "local"
      ],
      ExpressionStatement: [
        "expression"
      ],
      ForInStatement: [
        "left",
        "right",
        "body"
      ],
      ForOfStatement: [
        "left",
        "right",
        "body"
      ],
      ForStatement: [
        "init",
        "test",
        "update",
        "body"
      ],
      FunctionDeclaration: [
        "id",
        "params",
        "body"
      ],
      FunctionExpression: [
        "id",
        "params",
        "body"
      ],
      Identifier: [],
      IfStatement: [
        "test",
        "consequent",
        "alternate"
      ],
      ImportDeclaration: [
        "specifiers",
        "source"
      ],
      ImportDefaultSpecifier: [
        "local"
      ],
      ImportExpression: [
        "source"
      ],
      ImportNamespaceSpecifier: [
        "local"
      ],
      ImportSpecifier: [
        "imported",
        "local"
      ],
      JSXAttribute: [
        "name",
        "value"
      ],
      JSXClosingElement: [
        "name"
      ],
      JSXClosingFragment: [],
      JSXElement: [
        "openingElement",
        "children",
        "closingElement"
      ],
      JSXEmptyExpression: [],
      JSXExpressionContainer: [
        "expression"
      ],
      JSXFragment: [
        "openingFragment",
        "children",
        "closingFragment"
      ],
      JSXIdentifier: [],
      JSXMemberExpression: [
        "object",
        "property"
      ],
      JSXNamespacedName: [
        "namespace",
        "name"
      ],
      JSXOpeningElement: [
        "name",
        "attributes"
      ],
      JSXOpeningFragment: [],
      JSXSpreadAttribute: [
        "argument"
      ],
      JSXSpreadChild: [
        "expression"
      ],
      JSXText: [],
      LabeledStatement: [
        "label",
        "body"
      ],
      Literal: [],
      LogicalExpression: [
        "left",
        "right"
      ],
      MemberExpression: [
        "object",
        "property"
      ],
      MetaProperty: [
        "meta",
        "property"
      ],
      MethodDefinition: [
        "key",
        "value"
      ],
      NewExpression: [
        "callee",
        "arguments"
      ],
      ObjectExpression: [
        "properties"
      ],
      ObjectPattern: [
        "properties"
      ],
      PrivateIdentifier: [],
      Program: [
        "body"
      ],
      Property: [
        "key",
        "value"
      ],
      PropertyDefinition: [
        "key",
        "value"
      ],
      RestElement: [
        "argument"
      ],
      ReturnStatement: [
        "argument"
      ],
      SequenceExpression: [
        "expressions"
      ],
      SpreadElement: [
        "argument"
      ],
      StaticBlock: [
        "body"
      ],
      Super: [],
      SwitchCase: [
        "test",
        "consequent"
      ],
      SwitchStatement: [
        "discriminant",
        "cases"
      ],
      TaggedTemplateExpression: [
        "tag",
        "quasi"
      ],
      TemplateElement: [],
      TemplateLiteral: [
        "quasis",
        "expressions"
      ],
      ThisExpression: [],
      ThrowStatement: [
        "argument"
      ],
      TryStatement: [
        "block",
        "handler",
        "finalizer"
      ],
      UnaryExpression: [
        "argument"
      ],
      UpdateExpression: [
        "argument"
      ],
      VariableDeclaration: [
        "declarations"
      ],
      VariableDeclarator: [
        "id",
        "init"
      ],
      WhileStatement: [
        "test",
        "body"
      ],
      WithStatement: [
        "object",
        "body"
      ],
      YieldExpression: [
        "argument"
      ]
    };
    var NODE_TYPES = Object.keys(KEYS);
    for (const type of NODE_TYPES) {
      Object.freeze(KEYS[type]);
    }
    Object.freeze(KEYS);
    var KEY_BLACKLIST = /* @__PURE__ */ new Set([
      "parent",
      "leadingComments",
      "trailingComments"
    ]);
    function filterKey(key) {
      return !KEY_BLACKLIST.has(key) && key[0] !== "_";
    }
    function getKeys(node) {
      return Object.keys(node).filter(filterKey);
    }
    function unionWith(additionalKeys) {
      const retv = (
        /** @type {{
            [type: string]: ReadonlyArray<string>
        }} */
        Object.assign({}, KEYS)
      );
      for (const type of Object.keys(additionalKeys)) {
        if (Object.prototype.hasOwnProperty.call(retv, type)) {
          const keys = new Set(additionalKeys[type]);
          for (const key of retv[type]) {
            keys.add(key);
          }
          retv[type] = Object.freeze(Array.from(keys));
        } else {
          retv[type] = Object.freeze(Array.from(additionalKeys[type]));
        }
      }
      return Object.freeze(retv);
    }
    exports2.KEYS = KEYS;
    exports2.getKeys = getKeys;
    exports2.unionWith = unionWith;
  }
});

// node_modules/.pnpm/toml-eslint-parser@0.10.0/node_modules/toml-eslint-parser/lib/visitor-keys.js
var require_visitor_keys = __commonJS({
  "node_modules/.pnpm/toml-eslint-parser@0.10.0/node_modules/toml-eslint-parser/lib/visitor-keys.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.KEYS = void 0;
    var eslint_visitor_keys_1 = require_eslint_visitor_keys();
    var tomlKeys = {
      Program: ["body"],
      TOMLTopLevelTable: ["body"],
      TOMLTable: ["key", "body"],
      TOMLKeyValue: ["key", "value"],
      TOMLKey: ["keys"],
      TOMLArray: ["elements"],
      TOMLInlineTable: ["body"],
      TOMLBare: [],
      TOMLQuoted: [],
      TOMLValue: []
    };
    exports2.KEYS = (0, eslint_visitor_keys_1.unionWith)(tomlKeys);
  }
});

// node_modules/.pnpm/toml-eslint-parser@0.10.0/node_modules/toml-eslint-parser/lib/parser.js
var require_parser = __commonJS({
  "node_modules/.pnpm/toml-eslint-parser@0.10.0/node_modules/toml-eslint-parser/lib/parser.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.parseForESLint = void 0;
    var toml_parser_1 = require_toml_parser();
    var visitor_keys_1 = require_visitor_keys();
    function parseForESLint(code, options) {
      const parser = new toml_parser_1.TOMLParser(code, options);
      const ast = parser.parse();
      return {
        ast,
        visitorKeys: visitor_keys_1.KEYS,
        services: {
          isTOML: true
        }
      };
    }
    exports2.parseForESLint = parseForESLint;
  }
});

// node_modules/.pnpm/toml-eslint-parser@0.10.0/node_modules/toml-eslint-parser/lib/traverse.js
var require_traverse = __commonJS({
  "node_modules/.pnpm/toml-eslint-parser@0.10.0/node_modules/toml-eslint-parser/lib/traverse.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.traverseNodes = exports2.getNodes = exports2.getKeys = exports2.getFallbackKeys = void 0;
    var visitor_keys_1 = require_visitor_keys();
    function fallbackKeysFilter(key) {
      let value = null;
      return key !== "comments" && key !== "leadingComments" && key !== "loc" && key !== "parent" && key !== "range" && key !== "tokens" && key !== "trailingComments" && (value = this[key]) !== null && typeof value === "object" && (typeof value.type === "string" || Array.isArray(value));
    }
    function getFallbackKeys(node) {
      return Object.keys(node).filter(fallbackKeysFilter, node);
    }
    exports2.getFallbackKeys = getFallbackKeys;
    function getKeys(node, visitorKeys) {
      const keys = (visitorKeys || visitor_keys_1.KEYS)[node.type] || getFallbackKeys(node);
      return keys.filter((key) => !getNodes(node, key).next().done);
    }
    exports2.getKeys = getKeys;
    function* getNodes(node, key) {
      const child2 = node[key];
      if (Array.isArray(child2)) {
        for (const c of child2) {
          if (isNode2(c)) {
            yield c;
          }
        }
      } else if (isNode2(child2)) {
        yield child2;
      }
    }
    exports2.getNodes = getNodes;
    function isNode2(x) {
      return x !== null && typeof x === "object" && typeof x.type === "string";
    }
    function traverse(node, parent, visitor) {
      visitor.enterNode(node, parent);
      const keys = getKeys(node, visitor.visitorKeys);
      for (const key of keys) {
        for (const child2 of getNodes(node, key)) {
          traverse(child2, node, visitor);
        }
      }
      visitor.leaveNode(node, parent);
    }
    function traverseNodes(node, visitor) {
      traverse(node, null, visitor);
    }
    exports2.traverseNodes = traverseNodes;
  }
});

// node_modules/.pnpm/toml-eslint-parser@0.10.0/node_modules/toml-eslint-parser/lib/utils.js
var require_utils = __commonJS({
  "node_modules/.pnpm/toml-eslint-parser@0.10.0/node_modules/toml-eslint-parser/lib/utils.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.generateConvertTOMLValue = exports2.getStaticTOMLValue = void 0;
    var internal_utils_1 = require_internal_utils();
    exports2.getStaticTOMLValue = generateConvertTOMLValue((node) => node.value);
    function generateConvertTOMLValue(convertValue) {
      function resolveValue(node, baseTable) {
        return resolver[node.type](node, baseTable);
      }
      const resolver = {
        Program(node, baseTable = {}) {
          return resolveValue(node.body[0], baseTable);
        },
        TOMLTopLevelTable(node, baseTable = {}) {
          for (const body of node.body) {
            resolveValue(body, baseTable);
          }
          return baseTable;
        },
        TOMLKeyValue(node, baseTable = {}) {
          const value = resolveValue(node.value);
          set(baseTable, resolveValue(node.key), value);
          return baseTable;
        },
        TOMLTable(node, baseTable = {}) {
          const table = getTable(baseTable, resolveValue(node.key), node.kind === "array");
          for (const body of node.body) {
            resolveValue(body, table);
          }
          return baseTable;
        },
        TOMLArray(node) {
          return node.elements.map((e) => resolveValue(e));
        },
        TOMLInlineTable(node) {
          const table = {};
          for (const body of node.body) {
            resolveValue(body, table);
          }
          return table;
        },
        TOMLKey(node) {
          return node.keys.map((key) => resolveValue(key));
        },
        TOMLBare(node) {
          return node.name;
        },
        TOMLQuoted(node) {
          return node.value;
        },
        TOMLValue(node) {
          return convertValue(node);
        }
      };
      return (node) => resolveValue(node);
    }
    exports2.generateConvertTOMLValue = generateConvertTOMLValue;
    function getTable(baseTable, keys, array) {
      let target = baseTable;
      for (let index = 0; index < keys.length - 1; index++) {
        const key = keys[index];
        target = getNextTargetFromKey(target, key);
      }
      const lastKey = (0, internal_utils_1.last)(keys);
      const lastTarget = target[lastKey];
      if (lastTarget == null) {
        const tableValue3 = {};
        target[lastKey] = array ? [tableValue3] : tableValue3;
        return tableValue3;
      }
      if (isValue(lastTarget)) {
        const tableValue3 = {};
        target[lastKey] = array ? [tableValue3] : tableValue3;
        return tableValue3;
      }
      if (!array) {
        if (Array.isArray(lastTarget)) {
          const tableValue3 = {};
          target[lastKey] = tableValue3;
          return tableValue3;
        }
        return lastTarget;
      }
      if (Array.isArray(lastTarget)) {
        const tableValue3 = {};
        lastTarget.push(tableValue3);
        return tableValue3;
      }
      const tableValue2 = {};
      target[lastKey] = [tableValue2];
      return tableValue2;
      function getNextTargetFromKey(currTarget, key) {
        const nextTarget = currTarget[key];
        if (nextTarget == null) {
          const val = {};
          currTarget[key] = val;
          return val;
        }
        if (isValue(nextTarget)) {
          const val = {};
          currTarget[key] = val;
          return val;
        }
        let resultTarget = nextTarget;
        while (Array.isArray(resultTarget)) {
          const lastIndex = resultTarget.length - 1;
          const nextElement = resultTarget[lastIndex];
          if (isValue(nextElement)) {
            const val = {};
            resultTarget[lastIndex] = val;
            return val;
          }
          resultTarget = nextElement;
        }
        return resultTarget;
      }
    }
    function set(baseTable, keys, value) {
      let target = baseTable;
      for (let index = 0; index < keys.length - 1; index++) {
        const key = keys[index];
        const nextTarget = target[key];
        if (nextTarget == null) {
          const val = {};
          target[key] = val;
          target = val;
        } else {
          if (isValue(nextTarget) || Array.isArray(nextTarget)) {
            const val = {};
            target[key] = val;
            target = val;
          } else {
            target = nextTarget;
          }
        }
      }
      target[(0, internal_utils_1.last)(keys)] = value;
    }
    function isValue(value) {
      return typeof value !== "object" || value instanceof Date;
    }
  }
});

// node_modules/.pnpm/toml-eslint-parser@0.10.0/node_modules/toml-eslint-parser/lib/meta.js
var require_meta = __commonJS({
  "node_modules/.pnpm/toml-eslint-parser@0.10.0/node_modules/toml-eslint-parser/lib/meta.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.version = exports2.name = void 0;
    exports2.name = "toml-eslint-parser";
    exports2.version = "0.10.0";
  }
});

// node_modules/.pnpm/toml-eslint-parser@0.10.0/node_modules/toml-eslint-parser/lib/index.js
var require_lib = __commonJS({
  "node_modules/.pnpm/toml-eslint-parser@0.10.0/node_modules/toml-eslint-parser/lib/index.js"(exports2) {
    "use strict";
    var __createBinding = exports2 && exports2.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = exports2 && exports2.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = exports2 && exports2.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.parseTOML = exports2.getStaticTOMLValue = exports2.traverseNodes = exports2.VisitorKeys = exports2.parseForESLint = exports2.ParseError = exports2.name = exports2.meta = void 0;
    var parser_1 = require_parser();
    Object.defineProperty(exports2, "parseForESLint", { enumerable: true, get: function() {
      return parser_1.parseForESLint;
    } });
    var traverse_1 = require_traverse();
    Object.defineProperty(exports2, "traverseNodes", { enumerable: true, get: function() {
      return traverse_1.traverseNodes;
    } });
    var utils_1 = require_utils();
    Object.defineProperty(exports2, "getStaticTOMLValue", { enumerable: true, get: function() {
      return utils_1.getStaticTOMLValue;
    } });
    var visitor_keys_1 = require_visitor_keys();
    var errors_1 = require_errors();
    Object.defineProperty(exports2, "ParseError", { enumerable: true, get: function() {
      return errors_1.ParseError;
    } });
    exports2.meta = __importStar(require_meta());
    var meta_1 = require_meta();
    Object.defineProperty(exports2, "name", { enumerable: true, get: function() {
      return meta_1.name;
    } });
    exports2.VisitorKeys = visitor_keys_1.KEYS;
    function parseTOML2(code, options) {
      return (0, parser_1.parseForESLint)(code, options).ast;
    }
    exports2.parseTOML = parseTOML2;
  }
});

// src/version.ts
var kurmisVersion = true ? "0.1.0" : "dev";

// src/cli/command.ts
var import_node_util = require("node:util");
var EXIT_OK = 0;
var EXIT_FAILURE = 1;
var EXIT_USAGE = 2;
function writeLine(output, text2 = "") {
  output.write(`${text2}
`);
}
function usageError(command, message, context) {
  writeLine(context.stderr, `kurmis ${command}: ${message}`);
  writeLine(context.stderr, `Run "kurmis help ${command}" for its options.`);
  return EXIT_USAGE;
}
function isHelpFlag(arg) {
  return arg === "--help" || arg === "-h";
}
function parseCommandArgs(command, args, options, context, allowPositionals = false) {
  try {
    const parsed = (0, import_node_util.parseArgs)({ args, options, allowPositionals, strict: true });
    return { values: parsed.values, positionals: parsed.positionals };
  } catch (error) {
    return usageError(command, error instanceof Error ? error.message : String(error), context);
  }
}

// src/cli/commands/claude.ts
var import_node_fs12 = require("node:fs");
var import_node_os8 = require("node:os");

// src/core/claude-usage.ts
var FIVE_HOUR_MINS = 5 * 60;
var SEVEN_DAY_MINS = 7 * 24 * 60;
var CLAUDE_WINDOWS = [
  {
    key: "five_hour",
    field: "fiveHour",
    label: "5 hour",
    short: "5h",
    windowDurationMins: FIVE_HOUR_MINS,
    plan: true
  },
  {
    key: "seven_day",
    field: "sevenDay",
    label: "7 day",
    short: "7d",
    windowDurationMins: SEVEN_DAY_MINS,
    plan: true
  },
  {
    key: "seven_day_overage_included",
    field: "sevenDayOverage",
    label: "7 day (extra usage)",
    short: "7d+",
    windowDurationMins: SEVEN_DAY_MINS,
    plan: true
  },
  {
    key: "seven_day_opus",
    field: "sevenDayOpus",
    label: "7 day Opus",
    short: "7d Opus",
    windowDurationMins: SEVEN_DAY_MINS,
    plan: false
  },
  {
    key: "seven_day_sonnet",
    field: "sevenDaySonnet",
    label: "7 day Sonnet",
    short: "7d Sonnet",
    windowDurationMins: SEVEN_DAY_MINS,
    plan: false
  }
];
function claudeWindowSpec(key) {
  return CLAUDE_WINDOWS.find((window) => window.key === key) ?? null;
}
function roundTenth(value) {
  return Math.round(value * 10) / 10;
}
function isoFromSeconds(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value * 1e3);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// src/core/usage.ts
function emptyAccountUsage(accountId, now) {
  return {
    accountId,
    provider: "claude",
    fetchedAt: now,
    source: "probe",
    subscriptionType: null,
    rateLimitsAvailable: false,
    fiveHour: null,
    sevenDay: null,
    sevenDayOverage: null,
    sevenDayOpus: null,
    sevenDaySonnet: null,
    modelScoped: [],
    extraUsage: null,
    status: null,
    limited: null,
    error: null
  };
}
function usageFromGetUsage(accountId, raw, now, previous = null) {
  const body = asRecord(raw);
  const limits = asRecord(body.rate_limits);
  const windows = percentWindows(limits);
  const carried = statusAfterProbe(previous, windows, now);
  return {
    ...emptyAccountUsage(accountId, now),
    subscriptionType: asString(body.subscription_type),
    rateLimitsAvailable: body.rate_limits_available === true,
    ...windows,
    modelScoped: modelScopedWindows(limits.model_scoped),
    extraUsage: extraUsage(limits.extra_usage),
    status: carried.status,
    limited: carried.limited
  };
}
function usageFromRateLimitEvent(accountId, previous, info, now) {
  const event = asRecord(info);
  const base = previous ?? emptyAccountUsage(accountId, now);
  const windows = eventWindows(event);
  const status2 = readStatus(event.status);
  const limited = limitedWindow(event);
  return {
    ...base,
    accountId,
    fetchedAt: now,
    source: "session",
    // A report with windows proves the token can read rate limits, whatever a failed probe said.
    rateLimitsAvailable: base.rateLimitsAvailable || countWindows(windows) > 0,
    fiveHour: windows.fiveHour ?? base.fiveHour,
    sevenDay: windows.sevenDay ?? base.sevenDay,
    sevenDayOverage: windows.sevenDayOverage ?? base.sevenDayOverage,
    sevenDayOpus: windows.sevenDayOpus ?? base.sevenDayOpus,
    sevenDaySonnet: windows.sevenDaySonnet ?? base.sevenDaySonnet,
    status: status2 ?? base.status,
    limited: limited ?? (status2 === null ? base.limited : null),
    // Fresh numbers, so whatever the last probe failed at no longer stands.
    error: null
  };
}
function statusAfterProbe(previous, fresh, now) {
  const status2 = previous?.status ?? null;
  if (previous === null || status2 === null) return { status: null, limited: null };
  const limited = previous.limited;
  if (limited === null) return { status: status2, limited: null };
  const resetAt = limited.resetsAt === null ? null : Date.parse(limited.resetsAt);
  if (resetAt !== null && Number.isFinite(resetAt) && resetAt <= now) {
    return { status: null, limited: null };
  }
  const spec = claudeWindowSpec(limited.window);
  const measured = spec === null ? void 0 : fresh[spec.field];
  if (measured === void 0) return { status: status2, limited };
  if (measured.utilization < (limited.threshold ?? 100)) return { status: null, limited: null };
  return {
    status: status2,
    limited: { ...limited, utilization: measured.utilization, resetsAt: measured.resetsAt }
  };
}
function limitedWindow(event) {
  const name = asString(event.rateLimitType);
  if (name === null) return null;
  const unified = asRecord(asRecord(event.unifiedWindows)[name]);
  const utilization = asNumber(event.utilization) ?? asNumber(unified.utilization);
  const threshold = asNumber(event.surpassedThreshold);
  return {
    window: name,
    utilization: utilization === null ? null : roundTenth(utilization * 100),
    threshold: threshold === null ? null : roundTenth(threshold * 100),
    resetsAt: isoFromSeconds(event.resetsAt) ?? isoFromSeconds(unified.resetsAt)
  };
}
function eventWindows(event) {
  const out = {};
  const unified = asRecord(event.unifiedWindows);
  for (const spec of CLAUDE_WINDOWS) {
    const window = fractionWindow(unified[spec.key]);
    if (window !== null) out[spec.field] = window;
  }
  const named = claudeWindowSpec(event.rateLimitType);
  if (named !== null && out[named.field] === void 0) {
    const window = fractionWindow(event);
    if (window !== null) out[named.field] = window;
  }
  return out;
}
function percentWindows(limits) {
  const out = {};
  for (const spec of CLAUDE_WINDOWS) {
    const window = percentWindow(limits[spec.key]);
    if (window !== null) out[spec.field] = window;
  }
  return out;
}
function countWindows(windows) {
  return Object.keys(windows).length;
}
function percentWindow(value) {
  const row = asRecord(value);
  const utilization = asNumber(row.utilization);
  if (utilization === null) return null;
  return { utilization: roundTenth(utilization), resetsAt: asString(row.resets_at) };
}
function fractionWindow(value) {
  const row = asRecord(value);
  const utilization = asNumber(row.utilization);
  if (utilization === null) return null;
  return { utilization: roundTenth(utilization * 100), resetsAt: isoFromSeconds(row.resetsAt) };
}
function modelScopedWindows(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const entry of value) {
    const row = asRecord(entry);
    const window = percentWindow(row);
    const displayName = asString(row.display_name);
    if (window === null || displayName === null) continue;
    out.push({ ...window, displayName });
  }
  return out;
}
function extraUsage(value) {
  if (typeof value !== "object" || value === null) return null;
  const row = value;
  return {
    isEnabled: row.is_enabled === true,
    monthlyLimit: asNumber(row.monthly_limit),
    usedCredits: asNumber(row.used_credits),
    utilization: asNumber(row.utilization),
    currency: asString(row.currency)
  };
}
function readStatus(value) {
  return value === "allowed" || value === "allowed_warning" || value === "rejected" ? value : null;
}
function asRecord(value) {
  return typeof value === "object" && value !== null ? value : {};
}
function asString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// src/core/countdown.ts
function parseTime(value) {
  if (value === null || value === void 0) return null;
  const at2 = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(at2) ? at2 : null;
}
function spanText(milliseconds) {
  const totalMinutes = Number.isFinite(milliseconds) ? Math.max(0, Math.floor(milliseconds / 6e4)) : 0;
  const totalHours = Math.floor(totalMinutes / 60);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const minutes = totalMinutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}
var COUNTDOWN_NOW = "now";
function resetIn(resetsAt, now) {
  const at2 = parseTime(resetsAt);
  if (at2 === null) return null;
  const left = at2 - now;
  return left < 6e4 ? COUNTDOWN_NOW : spanText(left);
}
function resetsInText(resetsAt, now = Date.now()) {
  const at2 = parseTime(resetsAt);
  if (at2 === null || at2 <= now) return null;
  return `resets in ${spanText(at2 - now)}`;
}
function countdownIn(value, now = Date.now()) {
  const until = resetIn(value, now);
  if (until === null) return null;
  return until === COUNTDOWN_NOW ? COUNTDOWN_NOW : `in ${until}`;
}

// src/core/codex-usage.ts
var CODEX_GENERAL_LIMIT_ID = "codex";
function codexWindowKey(limitId, half) {
  return `${limitId}:${half}`;
}
function codexWindowLimitId(key) {
  const cut = key.lastIndexOf(":");
  return cut <= 0 ? key : key.slice(0, cut);
}
function emptyCodexUsage(accountId, now) {
  return {
    accountId,
    provider: "codex",
    fetchedAt: now,
    source: "probe",
    subscriptionType: null,
    rateLimitsAvailable: false,
    fiveHour: null,
    sevenDay: null,
    sevenDayOverage: null,
    sevenDayOpus: null,
    sevenDaySonnet: null,
    modelScoped: [],
    windows: [],
    creditBalance: null,
    bankedResets: null,
    extraUsage: null,
    status: null,
    limited: null,
    error: null
  };
}
function codexUsageFromResult(accountId, result, now) {
  const read = parseCodexRateLimitsRead(result);
  return read === null ? null : usageFromCodexRateLimits(accountId, read, now);
}
function usageFromCodexRateLimits(accountId, response, now) {
  const main = response?.rateLimits ?? null;
  const buckets = bucketList(response);
  const windows = sortCodexUsageWindows(buckets.flatMap((bucket) => windowsOfBucket(bucket)));
  return {
    ...emptyCodexUsage(accountId, now),
    subscriptionType: main?.planType ?? buckets[0]?.planType ?? null,
    rateLimitsAvailable: windows.length > 0,
    windows,
    creditBalance: main?.credits?.balance ?? null,
    bankedResets: bankedResetsOf(response?.rateLimitResetCredits),
    status: statusOf(buckets)
  };
}
function bankedResetsOf(summary) {
  if (summary === null || summary === void 0) return null;
  const available = (summary.credits ?? []).filter((credit) => credit.status === "available");
  const expiresAt = available.map((credit) => isoFromSeconds(credit.expiresAt)).sort((a, b) => (a === null ? 1 : 0) - (b === null ? 1 : 0) || (a ?? "").localeCompare(b ?? ""));
  const reported = Number(summary.availableCount);
  const count = Math.max(Number.isFinite(reported) && reported > 0 ? Math.floor(reported) : 0, available.length);
  return { count, expiresAt };
}
function codexWindowLabel(windowDurationMins) {
  if (typeof windowDurationMins !== "number" || !Number.isFinite(windowDurationMins)) return "window";
  if (windowDurationMins < 60) return `${Math.round(windowDurationMins)}m`;
  const hours = windowDurationMins / 60;
  if (hours < 24) return `${String(roundTenth(hours))}h`;
  return `${String(roundTenth(hours / 24))}d`;
}
function sortCodexUsageWindows(windows) {
  return [...windows].sort(
    (a, b) => (a.windowDurationMins ?? Number.MAX_SAFE_INTEGER) - (b.windowDurationMins ?? Number.MAX_SAFE_INTEGER) || Number(a.key.endsWith("secondary")) - Number(b.key.endsWith("secondary")) || a.key.localeCompare(b.key)
  );
}
function bucketList(response) {
  const byId = response?.rateLimitsByLimitId;
  if (byId !== null && byId !== void 0) {
    const rows = Object.values(byId).filter(isSnapshot);
    if (rows.length > 0) return rows;
  }
  const single = response?.rateLimits;
  return single === null || single === void 0 ? [] : [single];
}
function codexLimitName(bucket) {
  const named = bucket.limitName;
  if (typeof named === "string" && named.length > 0) return named;
  const limitId = bucket.limitId ?? CODEX_GENERAL_LIMIT_ID;
  return limitId === CODEX_GENERAL_LIMIT_ID ? "Codex" : limitId;
}
function windowsOfBucket(bucket) {
  const limitId = bucket.limitId ?? CODEX_GENERAL_LIMIT_ID;
  const group = codexLimitName(bucket);
  const out = [];
  for (const [name, window] of [
    ["primary", bucket.primary],
    ["secondary", bucket.secondary]
  ]) {
    if (window === null || window === void 0) continue;
    out.push({
      key: codexWindowKey(limitId, name),
      label: `${group} ${codexWindowLabel(window.windowDurationMins)}`,
      group,
      windowDurationMins: window.windowDurationMins,
      utilization: window.usedPercent,
      resetsAt: isoFromSeconds(window.resetsAt)
    });
  }
  return out;
}
function statusOf(buckets) {
  if (buckets.some((bucket) => bucket.spendControlReached === true)) return "rejected";
  const general = buckets.filter((bucket) => (bucket.limitId ?? CODEX_GENERAL_LIMIT_ID) === CODEX_GENERAL_LIMIT_ID);
  const plan = general.length > 0 ? general : buckets;
  return plan.some((bucket) => typeof bucket.rateLimitReachedType === "string") ? "rejected" : null;
}
function isSnapshot(value) {
  return typeof value === "object" && value !== null;
}
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stringOrNull(value) {
  return typeof value === "string" ? value : null;
}
function finiteOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function parseWindow(value) {
  if (!isObject(value)) return null;
  const usedPercent = finiteOrNull(value["usedPercent"]);
  if (usedPercent === null) return null;
  return {
    usedPercent,
    windowDurationMins: finiteOrNull(value["windowDurationMins"]),
    resetsAt: finiteOrNull(value["resetsAt"])
  };
}
function parseSnapshot(value) {
  if (!isObject(value)) return null;
  const credits = value["credits"];
  return {
    limitId: stringOrNull(value["limitId"]),
    limitName: stringOrNull(value["limitName"]),
    primary: parseWindow(value["primary"]),
    secondary: parseWindow(value["secondary"]),
    credits: isObject(credits) ? { balance: stringOrNull(credits["balance"]) } : null,
    spendControlReached: typeof value["spendControlReached"] === "boolean" ? value["spendControlReached"] : null,
    planType: stringOrNull(value["planType"]),
    rateLimitReachedType: stringOrNull(value["rateLimitReachedType"])
  };
}
function parseResetCredits(value) {
  if (!isObject(value)) return null;
  const list = value["credits"];
  const credits = Array.isArray(list) ? list.flatMap((credit) => isObject(credit) && typeof credit["status"] === "string" ? [{ status: credit["status"], expiresAt: finiteOrNull(credit["expiresAt"]) }] : []) : null;
  return { availableCount: finiteOrNull(value["availableCount"]) ?? 0, credits };
}
function parseCodexRateLimitsRead(result) {
  if (!isObject(result)) return null;
  const byId = result["rateLimitsByLimitId"];
  let rateLimitsByLimitId = null;
  if (isObject(byId)) {
    rateLimitsByLimitId = /* @__PURE__ */ Object.create(null);
    for (const [limitId, bucket] of Object.entries(byId)) {
      const parsed = parseSnapshot(bucket);
      if (parsed !== null) rateLimitsByLimitId[limitId] = parsed;
    }
  }
  return {
    rateLimits: parseSnapshot(result["rateLimits"]),
    rateLimitsByLimitId,
    rateLimitResetCredits: parseResetCredits(result["rateLimitResetCredits"])
  };
}

// src/core/usage-rules.ts
var CODEX_HIDDEN_LIMIT_ID = "codex_bengalfox";
function shownUsageWindows(provider, windows) {
  if (provider !== "codex") return [...windows];
  return windows.filter((window) => codexWindowLimitId(window.key) !== CODEX_HIDDEN_LIMIT_ID);
}
function allUsageWindows(usage) {
  if (!usage) return [];
  if (usage.provider === "codex") return shownUsageWindows("codex", usage.windows ?? []);
  const out = [];
  for (const spec of CLAUDE_WINDOWS) {
    const window = spec.field === "sevenDayOverage" ? extraUsageWindow(usage) : usage[spec.field];
    if (window === null) continue;
    out.push({
      key: spec.key,
      label: spec.label,
      name: spec.label,
      windowDurationMins: spec.windowDurationMins,
      ...window
    });
  }
  for (const entry of usage.modelScoped) {
    if (repeatsModelWindow(usage, entry)) continue;
    out.push({
      key: entry.displayName,
      label: entry.displayName,
      name: `${entry.displayName} 7 day`,
      windowDurationMins: SEVEN_DAY_MINS,
      ...entry
    });
  }
  return out;
}
function repeatsModelWindow(usage, entry) {
  const name = entry.displayName.trim().toLowerCase();
  const fixed = name === "opus" ? usage.sevenDayOpus : name === "sonnet" ? usage.sevenDaySonnet : null;
  return fixed !== null && fixed.utilization === entry.utilization && sameTime(fixed.resetsAt, entry.resetsAt);
}
function sameTime(a, b) {
  return a === b || a !== null && b !== null && Date.parse(a) === Date.parse(b);
}
function extraUsageWindow(usage) {
  if (usage?.extraUsage?.isEnabled !== true) return null;
  const overage = usage.sevenDayOverage ?? null;
  const plain = usage.sevenDay;
  if (overage === null || plain === null) return overage;
  return overage.utilization === plain.utilization && sameTime(overage.resetsAt, plain.resetsAt) ? null : overage;
}
function planUsageWindows(usage) {
  if (!usage) return [];
  if (usage.provider === "codex") {
    const shown = shownUsageWindows("codex", usage.windows ?? []);
    const general = shown.filter((window) => codexWindowLimitId(window.key) === CODEX_GENERAL_LIMIT_ID);
    return general.length > 0 ? general : shown;
  }
  const plan = new Set(CLAUDE_WINDOWS.filter((spec) => spec.plan).map((spec) => spec.key));
  return allUsageWindows(usage).filter((window) => plan.has(window.key));
}
function busiestPlanWindow(usage) {
  let busiest = null;
  for (const window of planUsageWindows(usage)) {
    if (busiest === null || window.utilization > busiest.utilization) busiest = window;
  }
  return busiest;
}
function windowHasReset(window, now) {
  const at2 = parseTime(window?.resetsAt ?? null);
  return at2 !== null && at2 <= now;
}
function usageResetPassed(usage, now) {
  if (!usage) return false;
  return everyWindowOf(usage).some((window) => windowHasReset(window, now));
}
function usageAsOf(usage, now) {
  if (!usage) return usage;
  if (!usageResetPassed(usage, now)) return usage;
  const next = {
    ...usage,
    fiveHour: fieldAsOf(usage.fiveHour, now),
    sevenDay: fieldAsOf(usage.sevenDay, now),
    sevenDayOverage: fieldAsOf(usage.sevenDayOverage, now),
    sevenDayOpus: fieldAsOf(usage.sevenDayOpus, now),
    sevenDaySonnet: fieldAsOf(usage.sevenDaySonnet, now),
    modelScoped: usage.modelScoped.map((window) => emptyIfReset(window, now))
  };
  if (usage.windows !== void 0) {
    next.windows = usage.windows.map((window) => emptyIfReset(window, now));
  }
  if (usage.limited !== null && windowHasReset(usage.limited, now)) {
    next.limited = null;
    next.status = null;
  }
  return next;
}
function emptyIfReset(window, now) {
  return windowHasReset(window, now) ? { ...window, utilization: 0 } : window;
}
function fieldAsOf(window, now) {
  return window === null ? null : emptyIfReset(window, now);
}
function everyWindowOf(usage) {
  const out = [];
  for (const spec of CLAUDE_WINDOWS) {
    const window = usage[spec.field];
    if (window !== null && window !== void 0) out.push(window);
  }
  for (const window of usage.modelScoped) out.push(window);
  for (const window of usage.windows ?? []) out.push(window);
  return out;
}
function resetsAtFromUsage(usage) {
  if (!usage) return null;
  const full = planUsageWindows(usage).filter((window) => window.utilization >= 100).map((window) => usableReset(window.resetsAt)).filter(isString);
  if (full.length > 0) return latest(full);
  if (usage.status !== "rejected") return null;
  const named = usableReset(usage.limited?.resetsAt ?? null);
  if (named !== null) return named;
  return busiestReset(allUsageWindows(usage));
}
function busiestReset(windows) {
  let best = null;
  for (const window of windows) {
    const resetsAt = usableReset(window.resetsAt);
    if (resetsAt === null) continue;
    if (best === null || window.utilization > best.utilization) {
      best = { utilization: window.utilization, resetsAt };
    }
  }
  return best?.resetsAt ?? null;
}
function usableReset(resetsAt) {
  if (resetsAt === null || !Number.isFinite(Date.parse(resetsAt))) return null;
  return resetsAt;
}
function isString(value) {
  return value !== null;
}
function latest(times) {
  let best = null;
  let bestAt = -Infinity;
  for (const time of times) {
    const at2 = Date.parse(time);
    if (!Number.isFinite(at2) || at2 <= bestAt) continue;
    best = time;
    bestAt = at2;
  }
  return best;
}
function isSevenDayWindow(window) {
  return window.windowDurationMins === SEVEN_DAY_MINS;
}

// src/core/account-router.ts
var PREFIX = "anthropic-ratelimit-unified-";
var WINDOW_NAMES = {
  "5h": "five_hour",
  "7d": "seven_day",
  "7d_oi": "seven_day_overage_included",
  overage: "overage"
};
function parseUnifiedHeaders(get, now) {
  const windows = {};
  for (const suffix of Object.keys(WINDOW_NAMES)) {
    const utilization = get(`${PREFIX}${suffix}-utilization`);
    const reset = get(`${PREFIX}${suffix}-reset`);
    const status2 = get(`${PREFIX}${suffix}-status`);
    if (utilization == null && reset == null && status2 == null) continue;
    const fraction = headerNumber(utilization);
    windows[suffix] = {
      utilization: fraction !== null && fraction >= 0 && fraction <= 1 ? fraction : null,
      resetsAt: isoFromSeconds(headerNumber(reset)),
      status: readStatus2(status2)
    };
  }
  return {
    observedAt: now,
    status: readStatus2(get(`${PREFIX}status`)),
    resetsAt: isoFromSeconds(headerNumber(get(`${PREFIX}reset`))),
    representativeClaim: headerText(get(`${PREFIX}representative-claim`)),
    windows,
    overageStatus: readStatus2(get(`${PREFIX}overage-status`)),
    overageDisabledReason: headerText(get(`${PREFIX}overage-disabled-reason`))
  };
}
function usageFromUnifiedHeaders(accountId, previous, observation) {
  const unifiedWindows = {};
  for (const [suffix, window] of Object.entries(observation.windows)) {
    unifiedWindows[windowName(suffix)] = {
      utilization: window.utilization,
      resetsAt: secondsFromIso(window.resetsAt)
    };
  }
  return usageFromRateLimitEvent(accountId, previous, {
    status: observation.status,
    resetsAt: secondsFromIso(observation.resetsAt),
    rateLimitType: observation.representativeClaim === null ? null : windowName(observation.representativeClaim),
    unifiedWindows
  }, observation.observedAt);
}
function isDefinitiveQuotaRejection(status2, get) {
  return status2 === 429 && (readStatus2(get(`${PREFIX}status`)) === "rejected" || get(`${PREFIX}representative-claim`) != null || get(`${PREFIX}overage-status`) != null);
}
function quotaCooldownUntil(status2, get) {
  if (!isDefinitiveQuotaRejection(status2, get)) return null;
  const observation = parseUnifiedHeaders(get, 0);
  const named = observation.representativeClaim;
  const window = Object.entries(observation.windows).find(([suffix]) => named !== null && windowName(suffix) === windowName(named))?.[1];
  const reset = observation.resetsAt ?? window?.resetsAt ?? null;
  if (reset !== null) return Date.parse(reset);
  const rejected = Object.values(observation.windows).filter((entry) => entry.status === "rejected");
  return rejected.length === 0 ? Infinity : Math.max(
    ...rejected.map((entry) => entry.resetsAt === null ? Infinity : Date.parse(entry.resetsAt))
  );
}
function worstUtilisation(usage) {
  return busiestPlanWindow(usage)?.utilization ?? null;
}
var TOKEN_MARGIN_MS = 5 * 6e4;
function tokenIsFresh(expiresAt, now) {
  return expiresAt === null || expiresAt > now + TOKEN_MARGIN_MS;
}
function limitForWindow(account, window) {
  return isSevenDayWindow(window) ? account.weeklyLimitPercent : account.fiveHourLimitPercent;
}
function windowsAsOf(account, now) {
  return planUsageWindows(usageAsOf(account.usage, now));
}
function windowOverLimit(account, now) {
  let worst = null;
  for (const window of windowsAsOf(account, now)) {
    if (window.utilization < limitForWindow(account, window)) continue;
    if (worst === null || window.utilization > worst.utilization) worst = window;
  }
  return worst;
}
function routeBlock(account, now) {
  if (!account.autoRoute) return { kind: "auto-route-off" };
  if (!account.loggedIn) return { kind: "signed-out" };
  if (!account.credentialsReadable) return { kind: "no-credentials" };
  if (!tokenIsFresh(account.tokenExpiresAt, now)) return { kind: "token-expiring" };
  if (account.cooldownUntil !== null && account.cooldownUntil > now) {
    return { kind: "cooldown", until: Number.isFinite(account.cooldownUntil) ? account.cooldownUntil : null };
  }
  const over = windowOverLimit(account, now);
  if (over !== null) {
    return {
      kind: "over-limit",
      utilization: over.utilization,
      limitPercent: limitForWindow(account, over),
      window: over.label,
      resetsAt: over.resetsAt
    };
  }
  return null;
}
function eligible(account, now) {
  return routeBlock(account, now) === null;
}
function sevenDayResetOf(account) {
  for (const window of planUsageWindows(account.usage)) {
    if (!isSevenDayWindow(window) || window.resetsAt === null) continue;
    if (Number.isFinite(Date.parse(window.resetsAt))) return window.resetsAt;
  }
  return null;
}
function sevenDayResetTime(account) {
  const resetsAt = sevenDayResetOf(account);
  return resetsAt === null ? Infinity : Date.parse(resetsAt);
}
function effectivePin(session, accounts) {
  if (session.pinnedAccountId != null) return session.pinnedAccountId;
  if (accounts.some((account) => account.autoRoute)) return null;
  return session.homeAccountId;
}
function autoStartLogin(accounts, preferred) {
  const own2 = accounts.find((account) => account.machineOwn);
  if (own2 === void 0) throw new Error("autoStartLogin: the list has no login that plain claude uses");
  if (own2.loggedIn) return own2.id;
  const pool = accounts.filter((account) => account.autoRoute);
  const signedIn = pool.filter((account) => account.loggedIn);
  const from = signedIn.length > 0 ? signedIn : pool;
  return (from.find((account) => account.id === preferred) ?? from[0])?.id ?? own2.id;
}
function rankAccounts(session, accounts, now, exclude) {
  return accounts.filter((account) => !exclude.has(account.id) && eligible(account, now)).sort((a, b) => {
    if (a.useFirst !== b.useFirst) return a.useFirst ? -1 : 1;
    const current = Number(b.id === session.currentAccountId) - Number(a.id === session.currentAccountId);
    if (current !== 0) return current;
    const resetA = sevenDayResetTime(a);
    const resetB = sevenDayResetTime(b);
    if (resetA !== resetB) return resetA < resetB ? -1 : 1;
    return Number(b.id === session.homeAccountId) - Number(a.id === session.homeAccountId) || (worstUtilisation(usageAsOf(a.usage, now)) ?? 100) - (worstUtilisation(usageAsOf(b.usage, now)) ?? 100);
  });
}
function chooseAccount(session, accounts, now, exclude) {
  const pinned = effectivePin(session, accounts);
  if (pinned !== null) {
    return accounts.find((account) => account.id === pinned && !exclude.has(account.id) && account.loggedIn && account.credentialsReadable) ?? null;
  }
  return rankAccounts(session, accounts, now, exclude)[0] ?? null;
}
function replayDecision(input) {
  const { status: status2, get, servedBy, session, attempted } = input;
  if (session.pinnedAccountId != null || input.responseStarted || input.deadlineExpired) return { kind: "pass" };
  const previous = session.currentAccountId;
  if (status2 === 400 && previous !== null && previous !== servedBy && !attempted.has(previous)) {
    return { kind: "pin-back", to: previous };
  }
  const cooldownUntil = quotaCooldownUntil(status2, get);
  if (cooldownUntil === null) return { kind: "pass" };
  return { kind: "replay", reason: "quota", cooldownUntil };
}
function accountsInScope(session, accounts) {
  const pinned = effectivePin(session, accounts);
  return accounts.filter((account) => account.loggedIn && account.credentialsReadable && (pinned === null ? account.autoRoute : account.id === pinned));
}
function poolReadyAt(accounts, now, pinnedAccountId, homeAccountId) {
  const session = { homeAccountId, currentAccountId: null, pinnedAccountId };
  const pinned = effectivePin(session, accounts);
  let earliest = Infinity;
  for (const account of accountsInScope(session, accounts)) {
    let ready = Math.max(now, account.cooldownUntil ?? now);
    const full = windowsAsOf(account, now).filter((window) => window.utilization >= (pinned === null ? limitForWindow(account, window) : 100));
    for (const window of full) {
      const reset = window.resetsAt === null ? NaN : Date.parse(window.resetsAt);
      ready = Number.isFinite(reset) && reset > now ? Math.max(ready, reset) : Infinity;
    }
    earliest = Math.min(earliest, ready);
  }
  return Number.isFinite(earliest) ? earliest : null;
}
function readStatus2(value) {
  return value === "allowed" || value === "allowed_warning" || value === "rejected" ? value : null;
}
function headerText(value) {
  return value == null || value.trim() === "" ? null : value.trim();
}
function headerNumber(value) {
  const text2 = headerText(value);
  if (text2 === null) return null;
  const number = Number(text2);
  return Number.isFinite(number) ? number : null;
}
function secondsFromIso(value) {
  return value === null ? null : Date.parse(value) / 1e3;
}
function windowName(value) {
  return Object.hasOwn(WINDOW_NAMES, value) ? WINDOW_NAMES[value] : value;
}

// src/core/route-headers.ts
var import_node_crypto = require("node:crypto");

// src/core/accounts.ts
var ACCOUNT_PROVIDERS = ["claude", "codex"];
var DEFAULT_FIVE_HOUR_LIMIT_PERCENT = 100;
var DEFAULT_WEEKLY_LIMIT_PERCENT = 100;
var DEFAULT_AUTO_ROUTE = true;
var LOGIN_ID = /^[a-z0-9]{1,32}$/;
var RESERVED_IDS = /^(con|prn|aux|nul|com[0-9]|lpt[0-9]|none|invalid|claude|codex)$/;
function isLoginIdText(text2) {
  return LOGIN_ID.test(text2) && !RESERVED_IDS.test(text2);
}

// src/core/route-headers.ts
var KEY_HEADER = "x-kurmis-key";
var LOGIN_HEADER = "x-kurmis-login";
var STARTED_ON_HEADER = "x-kurmis-started-on";
var STARTED_ON_NONE = "none";
var SESSION_HEADER = "x-claude-code-session-id";
var KURMIS_HEADERS = [KEY_HEADER, LOGIN_HEADER, STARTED_ON_HEADER];
function parseCustomHeaders(value) {
  const out = [];
  for (const line of (value ?? "").split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const name = line.slice(0, colon).trim();
    if (name.length === 0) continue;
    out.push({ name, value: line.slice(colon + 1).trim() });
  }
  return out;
}
function formatCustomHeaders(headers) {
  return headers.map((header) => `${header.name}: ${header.value}`).join("\n");
}
function withRouteHeaders(existing, key, login, startedOn = null) {
  const own2 = parseCustomHeaders(existing).filter((header) => !KURMIS_HEADERS.includes(header.name.toLowerCase()));
  const added = [{ name: KEY_HEADER, value: key }];
  if (login !== null) added.push({ name: LOGIN_HEADER, value: login });
  if (startedOn !== null) added.push({ name: STARTED_ON_HEADER, value: startedOn });
  return formatCustomHeaders([...own2, ...added]);
}
function readRouteRequest(get, ownClaude) {
  const key = nonEmpty(get(KEY_HEADER));
  const named = nonEmpty(get(LOGIN_HEADER));
  const startedOn = nonEmpty(get(STARTED_ON_HEADER));
  return {
    key,
    login: named === null ? null : loginIdOrInvalid(named),
    startedOn: startedOn === null ? ownClaude : startedOn.toLowerCase() === STARTED_ON_NONE ? null : loginIdOrInvalid(startedOn),
    sessionId: nonEmpty(get(SESSION_HEADER))
  };
}
function loginIdOrInvalid(value) {
  return isLoginIdText(value) ? value : "invalid";
}
function routeKeyMatches(given, secret) {
  if (given === null || secret.length === 0) return false;
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(secret, "utf8");
  return a.length === b.length && (0, import_node_crypto.timingSafeEqual)(a, b);
}
function nonEmpty(value) {
  const text2 = value?.trim() ?? "";
  return text2.length === 0 ? null : text2;
}

// src/core/routed-env.ts
var ROUTED_CLI_MAX_RETRIES = 15;
var UNROUTED_KEY_VARIABLES = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];
var OAUTH_TOKEN_VARIABLES = ["CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR"];
var ROUTING_VARIABLES = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_CUSTOM_HEADERS",
  "ENABLE_TOOL_SEARCH",
  "CLAUDE_CODE_MAX_RETRIES"
];
var USER_OWNED_ROUTING_VARIABLES = ["ENABLE_TOOL_SEARCH", "CLAUDE_CODE_MAX_RETRIES"];
function withoutRoutedVariables(routed, names) {
  const set = {};
  for (const [name, value] of Object.entries(routed.set)) if (!names.includes(name)) set[name] = value;
  return { set, unset: routed.unset };
}
var DEFAULT_SECURE_STORAGE_DIR = "";
function routedClaudeEnv(input) {
  const startedOn = input.startedOn ?? null;
  if (input.login !== null && startedOn !== null && startedOn !== input.login) {
    throw new Error(`routedClaudeEnv: a CLI pinned to ${input.login} is started on that login, not on ${startedOn}`);
  }
  const set = {
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${String(input.port)}`,
    ANTHROPIC_CUSTOM_HEADERS: withRouteHeaders(input.inheritedCustomHeaders, input.key, input.login, startedOn),
    ENABLE_TOOL_SEARCH: "true",
    CLAUDE_CODE_MAX_RETRIES: String(ROUTED_CLI_MAX_RETRIES)
  };
  const unset = [...UNROUTED_KEY_VARIABLES, ...OAUTH_TOKEN_VARIABLES];
  if (input.secureStorageDir !== null && input.secureStorageDir.length === 0) {
    throw new Error("routedClaudeEnv: the folder of an extra login cannot be the empty string");
  }
  set["CLAUDE_SECURESTORAGE_CONFIG_DIR"] = input.secureStorageDir ?? DEFAULT_SECURE_STORAGE_DIR;
  return { set, unset };
}
function applyRoutedEnv(env, routed, windows = false) {
  const same2 = (a, b) => windows ? a.toUpperCase() === b.toUpperCase() : a === b;
  const replaced = [...routed.unset, ...Object.keys(routed.set)];
  const out = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === void 0 || replaced.some((other) => same2(name, other))) continue;
    out[name] = value;
  }
  return { ...out, ...routed.set };
}
function inheritedOAuthTokenVariables(env, windows = false) {
  return Object.entries(env).filter(([name, value]) => value !== void 0 && value !== "" && OAUTH_TOKEN_VARIABLES.some((other) => windows ? other.toUpperCase() === name.toUpperCase() : other === name)).map(([name]) => name);
}

// src/data/config.ts
var import_node_crypto5 = require("node:crypto");
var import_node_fs4 = require("node:fs");

// src/core/login-alias.ts
var RESERVED_ALIASES = /* @__PURE__ */ new Set(["claude", "codex"]);
var ALIAS = /^[a-z0-9][a-z0-9_-]{0,31}$/;
var MAX_ALIAS_LENGTH = 32;
var ALIAS_RULE = '1 to 32 lowercase letters, digits, "-" or "_", starting with a letter or digit, and not "claude" or "codex"';
function isAliasText(text2) {
  return ALIAS.test(text2) && !RESERVED_ALIASES.has(text2);
}
function aliasFromEmail(email) {
  const text2 = email.trim().toLowerCase();
  const at2 = text2.lastIndexOf("@");
  const domainDot = at2 < 0 ? -1 : text2.lastIndexOf(".");
  const withoutTld = domainDot > at2 ? text2.slice(0, domainDot) : text2;
  return trimDashes(trimDashes(withoutTld.replace(/[^a-z0-9]+/g, "-")).slice(0, MAX_ALIAS_LENGTH));
}
function trimDashes(text2) {
  return text2.replace(/^-+|-+$/g, "");
}
function automaticAlias(email, id, current, neighbours) {
  const base = email === null ? "" : aliasFromEmail(email);
  if (base === "") return id;
  const taken = /* @__PURE__ */ new Set([...neighbours.aliases, ...neighbours.ids]);
  const free = (alias) => !taken.has(alias) && !RESERVED_ALIASES.has(alias);
  if (current !== null && free(current) && isNumbered(current, base)) return current;
  if (free(base)) return base;
  for (let number = 2; ; number++) {
    const suffix = `-${String(number)}`;
    const candidate = trimDashes(base.slice(0, MAX_ALIAS_LENGTH - suffix.length)) + suffix;
    if (free(candidate)) return candidate;
  }
}
function isNumbered(alias, base) {
  if (alias === base) return true;
  const match = /^(.*)-([2-9]|[1-9][0-9]+)$/.exec(alias);
  if (match === null) return false;
  const suffix = `-${match[2]}`;
  return match[1] === trimDashes(base.slice(0, MAX_ALIAS_LENGTH - suffix.length));
}

// src/data/json-file.ts
var import_node_crypto2 = require("node:crypto");
var import_node_fs2 = require("node:fs");
var import_promises2 = require("node:fs/promises");
var import_node_path = require("node:path");

// src/platform/files.ts
var import_node_fs = require("node:fs");
var import_promises = require("node:fs/promises");
var PRIVATE_FILE_MODE = 384;
var PRIVATE_DIR_MODE = 448;
function userOnlyMode(mode) {
  return mode & 448;
}
function restrictToUserSync(path, platform = process.platform) {
  if (platform === "win32") return null;
  const mode = (0, import_node_fs.statSync)(path).mode & 511;
  if (userOnlyMode(mode) === mode) return null;
  (0, import_node_fs.chmodSync)(path, userOnlyMode(mode));
  return mode;
}
var LOCKED_FILE_CODES = ["EPERM", "EBUSY", "EACCES"];
var RENAME_RETRY_DELAYS_MS = [10, 20, 40, 80, 160, 200, 200, 200, 200];
function isLockedFileError(error) {
  if (typeof error !== "object" || error === null) return false;
  return LOCKED_FILE_CODES.includes(String(error.code));
}
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function retryWhileLockedSync(operation, platform = process.platform) {
  for (let attempt = 0; ; attempt++) {
    try {
      return operation();
    } catch (error) {
      const delay3 = RENAME_RETRY_DELAYS_MS[attempt];
      if (platform !== "win32" || delay3 === void 0 || !isLockedFileError(error)) throw error;
      sleepSync(delay3);
    }
  }
}
async function retryWhileLocked(operation, platform = process.platform) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const delay3 = RENAME_RETRY_DELAYS_MS[attempt];
      if (platform !== "win32" || delay3 === void 0 || !isLockedFileError(error)) throw error;
      await new Promise((resolve8) => setTimeout(resolve8, delay3));
    }
  }
}
function replaceFileSync(from, to) {
  retryWhileLockedSync(() => (0, import_node_fs.renameSync)(from, to));
}
async function replaceFile(from, to) {
  await retryWhileLocked(() => (0, import_promises.rename)(from, to));
}
function syncDirectorySync(dir) {
  if (process.platform === "win32") return;
  let fd = -1;
  try {
    fd = (0, import_node_fs.openSync)(dir, "r");
    (0, import_node_fs.fsyncSync)(fd);
  } catch {
  } finally {
    if (fd >= 0) (0, import_node_fs.closeSync)(fd);
  }
}
async function syncDirectory(dir) {
  if (process.platform === "win32") return;
  try {
    const handle = await (0, import_promises.open)(dir, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
  }
}
function makePrivateDirSync(dir) {
  (0, import_node_fs.mkdirSync)(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
}

// src/data/json-file.ts
var TEMP_FLAGS = import_node_fs2.constants.O_WRONLY | import_node_fs2.constants.O_CREAT | import_node_fs2.constants.O_EXCL;
function tempPathFor(path) {
  return `${path}.${String(process.pid)}.${(0, import_node_crypto2.randomBytes)(4).toString("hex")}.tmp`;
}
function writeFileAtomicSync(path, contents, options = {}) {
  const dir = (0, import_node_path.dirname)(path);
  makePrivateDirSync(dir);
  const temp = tempPathFor(path);
  const fd = (0, import_node_fs2.openSync)(temp, TEMP_FLAGS, options.mode ?? 420);
  try {
    try {
      (0, import_node_fs2.writeSync)(fd, contents);
      (0, import_node_fs2.fsyncSync)(fd);
    } finally {
      (0, import_node_fs2.closeSync)(fd);
    }
    replaceFileSync(temp, path);
  } catch (error) {
    (0, import_node_fs2.rmSync)(temp, { force: true });
    throw error;
  }
  syncDirectorySync(dir);
}
async function writeFileAtomic(path, contents, options = {}) {
  const dir = (0, import_node_path.dirname)(path);
  makePrivateDirSync(dir);
  const temp = tempPathFor(path);
  const handle = await (0, import_promises2.open)(temp, TEMP_FLAGS, options.mode ?? 420);
  try {
    try {
      await handle.writeFile(contents);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await replaceFile(temp, path);
  } catch (error) {
    await (0, import_promises2.rm)(temp, { force: true });
    throw error;
  }
  await syncDirectory(dir);
}
function formatJson(value) {
  return `${JSON.stringify(value, null, 2)}
`;
}
function writeJsonFileSync(path, value, options) {
  writeFileAtomicSync(path, formatJson(value), options);
}
async function writeJsonFile(path, value, options) {
  await writeFileAtomic(path, formatJson(value), options);
}
function isMissing(error) {
  return error?.code === "ENOENT";
}
function parseJsonText(text2) {
  try {
    return { status: "ok", value: JSON.parse(text2), text: text2 };
  } catch (error) {
    return { status: "corrupt", reason: error instanceof Error ? error.message : String(error) };
  }
}
function readJsonFileSync(path) {
  let text2;
  try {
    text2 = (0, import_node_fs2.readFileSync)(path, "utf8");
  } catch (error) {
    if (isMissing(error)) return { status: "missing" };
    throw error;
  }
  return parseJsonText(text2);
}
async function readJsonFile(path) {
  let text2;
  try {
    text2 = await (0, import_promises2.readFile)(path, "utf8");
  } catch (error) {
    if (isMissing(error)) return { status: "missing" };
    throw error;
  }
  return parseJsonText(text2);
}

// src/data/login-id.ts
var import_node_crypto3 = require("node:crypto");
var LOGIN_PROVIDERS = ACCOUNT_PROVIDERS;
var NEW_LOGIN_ID_LENGTH = 10;
var ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
function isLoginProvider(value) {
  return value === "claude" || value === "codex";
}
function isLoginId(text2) {
  return typeof text2 === "string" && isLoginIdText(text2);
}
function toLoginId(text2) {
  if (!isLoginId(text2)) {
    throw new Error(`"${text2}" is not a login id. A login id is 1 to 32 lowercase letters and digits.`);
  }
  return text2;
}
function newLoginId(taken = []) {
  const used = new Set(taken);
  for (; ; ) {
    let id = "";
    for (let index = 0; index < NEW_LOGIN_ID_LENGTH; index++) id += ID_ALPHABET[(0, import_node_crypto3.randomInt)(ID_ALPHABET.length)];
    if (!used.has(id) && isLoginIdText(id)) return id;
  }
}

// src/data/lock.ts
var import_node_crypto4 = require("node:crypto");
var import_node_fs3 = require("node:fs");
var import_node_path2 = require("node:path");
var DEFAULT_LOCK_TIMEOUT_MS = 15e3;
var DEFAULT_LOCK_STALE_MS = 1e4;
var DEFAULT_LOCK_RETRY_MS = 25;
var LockTimeoutError = class extends Error {
  constructor(path, holder, waitedMs) {
    const who = holder === null ? "Another kurmis process holds it" : `kurmis process ${String(holder.pid)} has held it since ${new Date(holder.createdAt).toISOString()}`;
    const waited = waitedMs < 1e3 ? `${String(Math.round(waitedMs))} ms` : `${String(Math.round(waitedMs / 1e3))} s`;
    super(
      `Could not lock ${path} within ${waited}. ${who}. If no other kurmis command is running, delete the file and try again.`
    );
    this.path = path;
    this.holder = holder;
    this.name = "LockTimeoutError";
  }
  path;
  holder;
};
var heldByThisProcess = /* @__PURE__ */ new Set();
function isProcessAlive(pid, kill = (p, s) => process.kill(p, s)) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
function readLock(path) {
  const text2 = (0, import_node_fs3.readFileSync)(path, "utf8");
  try {
    const value = JSON.parse(text2);
    if (value === null || typeof value !== "object") return null;
    const { pid, createdAt, token } = value;
    if (typeof pid !== "number" || typeof createdAt !== "number" || typeof token !== "string") return null;
    return { pid, createdAt, token };
  } catch {
    return null;
  }
}
function readLockHolder(path) {
  try {
    const contents = readLock(path);
    return contents === null ? null : { pid: contents.pid, createdAt: contents.createdAt };
  } catch {
    return null;
  }
}
function sleepSync2(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function codeOf(error) {
  return error?.code;
}
function createExclusive(path, text2, platform) {
  let fd;
  try {
    fd = (0, import_node_fs3.openSync)(path, "wx", PRIVATE_FILE_MODE);
  } catch (error) {
    if (codeOf(error) === "EEXIST") return false;
    if (platform === "win32" && isLockedFileError(error)) return false;
    throw error;
  }
  try {
    (0, import_node_fs3.writeSync)(fd, text2);
  } catch (error) {
    (0, import_node_fs3.closeSync)(fd);
    (0, import_node_fs3.rmSync)(path, { force: true });
    throw error;
  }
  (0, import_node_fs3.closeSync)(fd);
  return true;
}
function removeFile(path, platform) {
  retryWhileLockedSync(() => (0, import_node_fs3.rmSync)(path, { force: true }), platform);
}
function isStale(path, contents, options) {
  if (contents === null) {
    let modified;
    try {
      modified = (0, import_node_fs3.statSync)(path).mtimeMs;
    } catch {
      return false;
    }
    return options.now() - modified > options.staleMs;
  }
  if (!options.isAlive(contents.pid)) return true;
  return options.now() - contents.createdAt > options.staleMs;
}
function breakIfStale(path, options) {
  const breakPath = `${path}.break`;
  if (!createExclusive(breakPath, String(process.pid), options.platform)) {
    try {
      if (options.now() - (0, import_node_fs3.statSync)(breakPath).mtimeMs > options.staleMs) removeFile(breakPath, options.platform);
    } catch {
    }
    return;
  }
  try {
    let contents;
    try {
      contents = readLock(path);
    } catch {
      return;
    }
    if (isStale(path, contents, options)) removeFile(path, options.platform);
  } finally {
    removeFile(breakPath, options.platform);
  }
}
function acquireFileLockSync(path, options = {}) {
  if (heldByThisProcess.has(path)) throw new Error(`${path} is already locked by this process.`);
  const settings = {
    staleMs: options.staleMs ?? DEFAULT_LOCK_STALE_MS,
    isAlive: options.isAlive ?? ((pid) => isProcessAlive(pid)),
    now: options.now ?? Date.now,
    platform: options.platform ?? process.platform
  };
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const retryMs = options.retryMs ?? DEFAULT_LOCK_RETRY_MS;
  const token = (0, import_node_crypto4.randomBytes)(16).toString("hex");
  const started = Date.now();
  makePrivateDirSync((0, import_node_path2.dirname)(path));
  for (; ; ) {
    const contents = { pid: process.pid, createdAt: settings.now(), token };
    if (createExclusive(path, `${JSON.stringify(contents)}
`, settings.platform)) break;
    breakIfStale(path, settings);
    const waited = Date.now() - started;
    if (waited >= timeoutMs) throw new LockTimeoutError(path, readLockHolder(path), waited);
    sleepSync2(Math.min(timeoutMs - waited, 1 + Math.floor(Math.random() * retryMs)));
  }
  heldByThisProcess.add(path);
  let released = false;
  return {
    path,
    release() {
      if (released) return;
      released = true;
      heldByThisProcess.delete(path);
      let current;
      try {
        current = retryWhileLockedSync(() => readLock(path), settings.platform);
      } catch {
        return;
      }
      if (current?.token === token) removeFile(path, settings.platform);
    }
  };
}
function withFileLockSync(path, work, options = {}) {
  const lock = acquireFileLockSync(path, options);
  try {
    return work();
  } finally {
    lock.release();
  }
}

// src/data/paths.ts
var import_node_os = require("node:os");
var import_node_path3 = require("node:path");
function kurmisHome() {
  const override = process.env.KURMIS_HOME;
  if (override !== void 0 && override !== "") return (0, import_node_path3.resolve)(override);
  return (0, import_node_path3.join)((0, import_node_os.homedir)(), ".kurmis");
}
function configPath() {
  return (0, import_node_path3.join)(kurmisHome(), "config.json");
}
function daemonFilePath() {
  return (0, import_node_path3.join)(kurmisHome(), "daemon.json");
}
function keyPath() {
  return (0, import_node_path3.join)(kurmisHome(), "key");
}
function statePath() {
  return (0, import_node_path3.join)(kurmisHome(), "state.json");
}
function logPath() {
  return (0, import_node_path3.join)(kurmisHome(), "daemon.log");
}
function previousLogPath() {
  return (0, import_node_path3.join)(kurmisHome(), "daemon.log.1");
}
function configLockPath() {
  return (0, import_node_path3.join)(kurmisHome(), "config.json.lock");
}
function ownClaudeProbeFolder() {
  return (0, import_node_path3.join)(kurmisHome(), "probe", "claude-own");
}
function wrapperSettingsFolder() {
  return (0, import_node_path3.join)(kurmisHome(), "settings");
}
function probeWorkFolder() {
  return (0, import_node_path3.join)(kurmisHome(), "probe", "cwd");
}
function windowsAutostartScriptPath() {
  return (0, import_node_path3.join)(kurmisHome(), "autostart.js");
}
function pausedFilePath() {
  return (0, import_node_path3.join)(kurmisHome(), "paused.json");
}
function providerFolder(provider) {
  return (0, import_node_path3.join)(kurmisHome(), provider);
}
function loginFolder(login) {
  const id = toLoginId(login.id);
  if (login.machineOwn) {
    throw new Error(`${id} is the login plain ${login.provider} uses and has no folder in the kurmis data folder.`);
  }
  return (0, import_node_path3.join)(providerFolder(login.provider), id);
}
function loginLockPath(id) {
  return (0, import_node_path3.join)(kurmisHome(), "locks", `${toLoginId(id)}.lock`);
}
function codexMergedRecordPath(login) {
  const id = toLoginId(login.id);
  if (login.machineOwn || login.provider !== "codex") throw new Error(`${id} is not an extra Codex login.`);
  return (0, import_node_path3.join)(kurmisHome(), "codex-merged", `${id}.json`);
}

// src/data/validate.ts
var DataFileError = class extends Error {
  constructor(file, field, problem) {
    super(field === null ? `${file}: ${problem}` : `${file}: ${field} ${problem}`);
    this.file = file;
    this.field = field;
    this.name = "DataFileError";
  }
  file;
  field;
};
function topOf(file) {
  return { file, field: "" };
}
function child(where, key) {
  if (typeof key === "number") return { file: where.file, field: `${where.field}[${String(key)}]` };
  return { file: where.file, field: where.field === "" ? key : `${where.field}.${key}` };
}
function fail(where, problem) {
  throw new DataFileError(where.file, where.field === "" ? null : where.field, problem);
}
function describe(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  if (typeof value === "string") return "a string";
  if (typeof value === "object") return "an object";
  return String(value);
}
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function expectObject(value, where) {
  if (!isPlainObject(value)) fail(where, `must be an object, not ${describe(value)}`);
  return value;
}
function expectArray(value, where) {
  if (!Array.isArray(value)) fail(where, `must be a list, not ${describe(value)}`);
  return value;
}
function expectString(value, where) {
  if (typeof value !== "string") fail(where, `must be a string, not ${describe(value)}`);
  return value;
}
function expectBoolean(value, where) {
  if (typeof value !== "boolean") fail(where, `must be true or false, not ${describe(value)}`);
  return value;
}
function expectInteger(value, where, min, max) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    fail(where, `must be a whole number from ${String(min)} to ${String(max)}, not ${describe(value)}`);
  }
  return value;
}

// src/data/config.ts
var CONFIG_VERSION = 2;
var DEFAULT_PORT = 28411;
var MIN_PORT = 1024;
var MAX_PORT = 65535;
var ConfigError = class extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "ConfigError";
  }
};
function machineOwnLogin(config, provider) {
  const own2 = config.logins.find((login) => login.machineOwn && login.provider === provider);
  if (own2 === void 0) throw new ConfigError(`The config has no login that plain ${provider} uses.`);
  return own2;
}
function extraLogins(config, provider) {
  return config.logins.filter((login) => !login.machineOwn && (provider === void 0 || login.provider === provider));
}
function newLoginSettings(ref, patch = {}) {
  const login = {
    id: ref.id,
    provider: ref.provider,
    machineOwn: ref.machineOwn,
    alias: ref.id,
    aliasSetByUser: false,
    routing: DEFAULT_AUTO_ROUTE,
    fiveHourLimit: DEFAULT_FIVE_HOUR_LIMIT_PERCENT,
    weeklyLimit: DEFAULT_WEEKLY_LIMIT_PERCENT,
    useFirst: false
  };
  return withConfigErrors(() => applyPatch(login, patch, topOf(`settings of ${ref.id}`)));
}
function withConfigErrors(check) {
  try {
    return check();
  } catch (error) {
    if (error instanceof DataFileError) throw new ConfigError(error.message);
    throw error;
  }
}
function emptyConfig() {
  return { version: CONFIG_VERSION, port: DEFAULT_PORT, logins: [] };
}
function defaultConfig() {
  return ensureMachineOwnLogins(emptyConfig());
}
function ensureMachineOwnLogins(config) {
  const missing = LOGIN_PROVIDERS.filter((provider) => !config.logins.some((login) => login.machineOwn && login.provider === provider));
  if (missing.length === 0) return config;
  const ids = [...loginIds(config), ...config.logins.map((login) => login.alias)];
  const added = missing.map((provider) => {
    const id = newLoginId(ids);
    ids.push(id);
    return newLoginSettings({ id, provider, machineOwn: true });
  });
  return { ...config, logins: ordered([...config.logins, ...added]) };
}
function ordered(logins) {
  const own2 = LOGIN_PROVIDERS.flatMap((provider) => logins.filter((login) => login.machineOwn && login.provider === provider));
  return [...own2, ...logins.filter((login) => !login.machineOwn)];
}
function checkLimit(value, where) {
  return expectInteger(value, where, 1, 100);
}
function checkAlias(value, where) {
  const alias = expectString(value, where);
  if (!isAliasText(alias)) fail(where, `must be ${ALIAS_RULE}`);
  return alias;
}
function applyPatch(login, patch, where) {
  const next = { ...login };
  if (patch.alias !== void 0) {
    next.alias = checkAlias(patch.alias, child(where, "alias"));
    next.aliasSetByUser = true;
  }
  if (patch.routing !== void 0) next.routing = expectBoolean(patch.routing, child(where, "routing"));
  if (patch.fiveHourLimit !== void 0) next.fiveHourLimit = checkLimit(patch.fiveHourLimit, child(where, "fiveHourLimit"));
  if (patch.weeklyLimit !== void 0) next.weeklyLimit = checkLimit(patch.weeklyLimit, child(where, "weeklyLimit"));
  if (patch.useFirst !== void 0) next.useFirst = expectBoolean(patch.useFirst, child(where, "useFirst"));
  return next;
}
function parseLogin(value, where) {
  const raw = expectObject(value, where);
  const id = expectString(raw.id, child(where, "id"));
  if (!isLoginId(id)) fail(child(where, "id"), "must be 1 to 32 lowercase letters and digits");
  const provider = expectString(raw.provider, child(where, "provider"));
  if (!isLoginProvider(provider)) fail(child(where, "provider"), 'must be "claude" or "codex"');
  const machineOwn = raw.machineOwn === void 0 ? false : expectBoolean(raw.machineOwn, child(where, "machineOwn"));
  const patch = {};
  for (const key of ["routing", "fiveHourLimit", "weeklyLimit", "useFirst"]) {
    if (raw[key] !== void 0) patch[key] = raw[key];
  }
  const login = applyPatch(newLoginSettings({ id, provider, machineOwn }), patch, where);
  if (raw.alias !== void 0) login.alias = checkAlias(raw.alias, child(where, "alias"));
  if (raw.aliasSetByUser !== void 0) login.aliasSetByUser = expectBoolean(raw.aliasSetByUser, child(where, "aliasSetByUser"));
  return login;
}
function checkVersion(raw, file) {
  const version = raw.version;
  if (version === void 0) fail(topOf(file), 'has no "version" field');
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    fail(child(topOf(file), "version"), "must be a whole number of 1 or more");
  }
  if (version > CONFIG_VERSION) {
    fail(
      topOf(file),
      `was written by a newer kurmis (config version ${String(version)}); this kurmis reads version ${String(CONFIG_VERSION)}. Update kurmis.`
    );
  }
  if (version < CONFIG_VERSION) {
    fail(
      topOf(file),
      `was written by an older kurmis (config version ${String(version)}), and this kurmis reads only version ${String(CONFIG_VERSION)}. Delete the file, then add the extra logins again with "kurmis login claude" and "kurmis login codex"`
    );
  }
}
function parseConfig(value, file) {
  const raw = expectObject(value, topOf(file));
  checkVersion(raw, file);
  const where = topOf(file);
  const port = raw.port === void 0 ? DEFAULT_PORT : expectInteger(raw.port, child(where, "port"), MIN_PORT, MAX_PORT);
  const listed = raw.logins === void 0 ? [] : expectArray(raw.logins, child(where, "logins"));
  const logins = [];
  listed.forEach((entry, index) => {
    const at2 = child(child(where, "logins"), index);
    const login = parseLogin(entry, at2);
    if (logins.some((other) => other.id === login.id)) fail(child(at2, "id"), `repeats "${login.id}"`);
    if (login.machineOwn && logins.some((other) => other.machineOwn && other.provider === login.provider)) {
      fail(
        child(at2, "machineOwn"),
        `is true for a second ${login.provider} login; only one ${login.provider} login can be the one plain ${login.provider} uses`
      );
    }
    const clash = logins.find((other) => other.id === login.alias || other.alias === login.id || other.provider === login.provider && other.alias === login.alias);
    if (clash !== void 0) {
      fail(child(at2, "alias"), clash.provider === login.provider && clash.alias === login.alias ? `repeats "${login.alias}" of another ${login.provider} login` : `"${login.alias}" and the id "${login.id}" must not be the id or alias of another login`);
    }
    logins.push(login);
  });
  return { version: CONFIG_VERSION, port, logins: ordered(logins) };
}
function readConfigFile(path) {
  const read = readJsonFileSync(path);
  if (read.status === "missing") return emptyConfig();
  if (read.status === "corrupt") throw new ConfigError(`${path} is not valid JSON: ${read.reason}`);
  return withConfigErrors(() => parseConfig(read.value, path));
}
function loadConfig(path = configPath(), lockOptions = {}) {
  const config = readConfigFile(path);
  if (ensureMachineOwnLogins(config) === config) return config;
  return changeConfig((current) => current, path, lockOptions);
}
function saveConfig(config, path = configPath()) {
  writeJsonFileSync(path, { version: CONFIG_VERSION, port: config.port, logins: config.logins });
}
function findLogin(config, id) {
  return config.logins.find((login) => login.id === id);
}
function loginIds(config) {
  return config.logins.map((login) => login.id);
}
function newLoginIdFor(config) {
  return newLoginId([...loginIds(config), ...config.logins.map((login) => login.alias)]);
}
var PROVIDER_NAMES = { claude: "Claude", codex: "Codex" };
function resolveLogin(config, text2, provider) {
  const typed = text2.trim().toLowerCase();
  const colon = typed.indexOf(":");
  let scope = provider;
  let name = typed;
  if (colon >= 0) {
    const prefix = typed.slice(0, colon);
    if (!isLoginProvider(prefix)) return { error: `"${text2}" names no login; give an alias or id, or claude:<alias> or codex:<alias>` };
    if (provider !== void 0 && prefix !== provider) {
      return { error: `"${text2}" is a ${PROVIDER_NAMES[prefix]} login; this takes a ${PROVIDER_NAMES[provider]} login` };
    }
    scope = prefix;
    name = typed.slice(colon + 1);
  }
  const inScope = config.logins.filter((login) => scope === void 0 || login.provider === scope);
  const byId = inScope.find((login) => login.id === name);
  if (byId !== void 0) return { login: byId };
  const byAlias = inScope.filter((login) => login.alias === name);
  if (byAlias.length === 1) return { login: byAlias[0] };
  if (byAlias.length > 1) {
    return { error: `a Claude login and a Codex login are both called "${name}"; give claude:${name} or codex:${name}` };
  }
  const other = provider === void 0 ? void 0 : config.logins.find((login) => login.provider !== provider && (login.id === name || login.alias === name));
  if (other !== void 0 && provider !== void 0) {
    return { error: `"${name}" is a ${PROVIDER_NAMES[other.provider]} login; this takes a ${PROVIDER_NAMES[provider]} login` };
  }
  const what = scope === void 0 ? "login" : `${PROVIDER_NAMES[scope]} login`;
  return { error: `there is no ${what} called "${name}"` };
}
function aliasProblem(config, login, alias) {
  if (!isAliasText(alias)) return `"${alias}" is not an alias; an alias is ${ALIAS_RULE}`;
  for (const other of config.logins) {
    if (other.id === login.id) continue;
    if (other.id === alias) return `"${alias}" is the id of another login`;
    if (other.provider === login.provider && other.alias === alias) {
      return `another ${PROVIDER_NAMES[login.provider]} login is already called "${alias}"`;
    }
  }
  return null;
}
function addLogin(config, ref, patch = {}) {
  if (!isLoginId(ref.id)) throw new ConfigError(`"${ref.id}" is not a login id.`);
  if (findLogin(config, ref.id) !== void 0) throw new ConfigError(`There is already a login ${ref.id}.`);
  if (config.logins.some((other) => other.alias === ref.id)) throw new ConfigError(`"${ref.id}" is the alias of another login.`);
  const login = newLoginSettings({ id: ref.id, provider: ref.provider, machineOwn: false }, patch);
  const problem = aliasProblem(config, login, login.alias);
  if (problem !== null) throw new ConfigError(`${capitalized(problem)}.`);
  return { ...config, logins: [...config.logins, login] };
}
function removeLogin(config, id) {
  const login = findLogin(config, id);
  if (login === void 0) throw new ConfigError(`There is no login ${id}.`);
  if (login.machineOwn) throw new ConfigError(`${login.alias} is the login plain ${login.provider} uses and cannot be removed.`);
  return { ...config, logins: config.logins.filter((other) => other.id !== id) };
}
function updateLogin(config, id, patch) {
  const current = findLogin(config, id);
  if (current === void 0) throw new ConfigError(`There is no login ${id}.`);
  const next = withConfigErrors(() => applyPatch(current, patch, topOf(`settings of ${current.alias}`)));
  if (patch.alias !== void 0) {
    const problem = aliasProblem(config, current, next.alias);
    if (problem !== null) throw new ConfigError(`${capitalized(problem)}.`);
  }
  return { ...config, logins: config.logins.map((login) => login.id === id ? next : login) };
}
function followEmail(config, id, email) {
  const login = findLogin(config, id);
  if (email === null || login === void 0 || login.aliasSetByUser) return config;
  const others = config.logins.filter((other) => other.id !== id);
  const alias = automaticAlias(email, login.id, login.alias, {
    aliases: others.filter((other) => other.provider === login.provider).map((other) => other.alias),
    ids: others.map((other) => other.id)
  });
  if (alias === login.alias) return config;
  return { ...config, logins: config.logins.map((other) => other.id === id ? { ...login, alias } : other) };
}
function capitalized(text2) {
  return text2.charAt(0).toUpperCase() + text2.slice(1);
}
function changeConfig(change, path = configPath(), lockOptions = {}) {
  const lockPath = path === configPath() ? configLockPath() : `${path}.lock`;
  try {
    return withFileLockSync(lockPath, () => {
      const next = change(ensureMachineOwnLogins(readConfigFile(path)));
      saveConfig(next, path);
      return next;
    }, lockOptions);
  } catch (error) {
    if (error instanceof LockTimeoutError) throw new ConfigError(error.message, { cause: error });
    throw error;
  }
}
function configStamp(path = configPath()) {
  try {
    return (0, import_node_crypto5.createHash)("sha256").update((0, import_node_fs4.readFileSync)(path)).digest("hex");
  } catch (error) {
    if (error.code === "ENOENT") return "missing";
    throw error;
  }
}

// src/data/login-env.ts
var import_node_fs5 = require("node:fs");
var import_node_os2 = require("node:os");
var import_node_path4 = require("node:path");

// src/core/codex-choice.ts
var CODEX_USAGE_MAX_AGE_MS = 20 * 6e4;
function codexSignedIn(login) {
  return login.signedIn !== false;
}
function codexRouteAccounts(status2) {
  return status2.logins.filter((login) => login.provider === "codex").map((login) => {
    const signedIn = codexSignedIn(login);
    return {
      id: login.id,
      loggedIn: signedIn,
      // Codex signs its own requests, so a login it is signed in to is one it can use.
      credentialsReadable: signedIn,
      tokenExpiresAt: null,
      usage: login.usage,
      autoRoute: login.routing,
      fiveHourLimitPercent: login.fiveHourLimit,
      weeklyLimitPercent: login.weeklyLimit,
      useFirst: login.useFirst,
      cooldownUntil: refusedUntil(login.usage)
    };
  });
}
function refusedUntil(usage) {
  if (usage?.status !== "rejected") return null;
  const reset = resetsAtFromUsage(usage);
  const at2 = reset === null ? NaN : Date.parse(reset);
  return Number.isFinite(at2) ? at2 : Infinity;
}
function ownCodexLogin(status2) {
  const own2 = status2.logins.find((login) => login.provider === "codex" && login.machineOwn);
  if (own2 === void 0) throw new Error("The daemon's status has no login that plain codex uses.");
  return own2;
}
function aliasIn(status2, id) {
  return status2.logins.find((login) => login.id === id)?.alias ?? id;
}
function chooseCodexLogin(status2, now) {
  const ownId = ownCodexLogin(status2).id;
  const session = { homeAccountId: ownId, currentAccountId: null, pinnedAccountId: null };
  const rows = codexRouteAccounts(status2);
  const chosen = chooseAccount(session, rows, now, /* @__PURE__ */ new Set());
  const pinned = effectivePin(session, rows);
  if (chosen !== null) return { login: chosen.id, kind: pinned === null ? "ranked" : "machine-own", note: null };
  if (pinned !== null) {
    return {
      login: pinned,
      kind: "none-signed-in",
      note: `${aliasIn(status2, pinned)} does not look signed in; starting Codex on it anyway.`
    };
  }
  const inScope = accountsInScope(session, rows);
  if (inScope.length === 0) {
    return {
      login: ownId,
      kind: "none-signed-in",
      note: `No Codex login that routing may use is signed in; starting on ${aliasIn(status2, ownId)}, the login plain codex uses.`
    };
  }
  let best = null;
  for (const row of inScope) {
    const readyAt = poolReadyAt([row], now, null, ownId);
    if (readyAt !== null && (best === null || readyAt < best.readyAt)) best = { id: row.id, readyAt };
  }
  if (best === null) {
    const first = inScope[0];
    return {
      login: first.id,
      kind: "all-out",
      note: `Every Codex login is at its limit and none says when it resets; starting on ${aliasIn(status2, first.id)}.`
    };
  }
  const when = countdownIn(best.readyAt, now) ?? "now";
  return {
    login: best.id,
    kind: "all-out",
    note: `Every Codex login is at its limit; starting on ${aliasIn(status2, best.id)}, whose usage comes back first (${when}).`
  };
}
function codexRouteBlock(status2, id, now) {
  const row = codexRouteAccounts(status2).find((account) => account.id === id);
  return row === void 0 ? null : routeBlock(row, now);
}
function codexUsageStale(login, now) {
  return login.usage === null || now - login.usage.fetchedAt > CODEX_USAGE_MAX_AGE_MS;
}
function codexLoginsToProbe(status2, now) {
  const candidates = status2.logins.filter((login) => login.provider === "codex" && login.routing && codexSignedIn(login));
  if (candidates.length < 2) return [];
  return candidates.filter((login) => codexUsageStale(login, now)).map((login) => login.id);
}
function isKurmisCodexHome(codexHome, codexLoginsFolder, windows) {
  if (codexHome === void 0 || codexHome === "") return false;
  const normal = (path) => {
    const slashes = windows ? path.replace(/\//g, "\\") : path;
    const trimmed = slashes.replace(windows ? /\\+$/ : /\/+$/, "");
    return windows ? trimmed.toLowerCase() : trimmed;
  };
  const home = normal(codexHome);
  const folder = normal(codexLoginsFolder);
  return home.startsWith(folder + (windows ? "\\" : "/"));
}

// src/data/login-env.ts
var NOT_INHERITED = {
  ANTHROPIC_API_KEY: void 0,
  ANTHROPIC_AUTH_TOKEN: void 0,
  CLAUDE_CODE_OAUTH_TOKEN: void 0,
  CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: void 0,
  ANTHROPIC_BASE_URL: void 0,
  ANTHROPIC_CUSTOM_HEADERS: void 0
};
var FORCE_CREDENTIAL_MANAGER_VARIABLE = "CLAUDE_CODE_FORCE_WINDOWS_CREDMAN";
function claudeLoginEnv(login, forceCredentialManager = false) {
  const force = forceCredentialManager ? { [FORCE_CREDENTIAL_MANAGER_VARIABLE]: "1" } : {};
  if (login.machineOwn) {
    return { CLAUDE_CONFIG_DIR: void 0, CLAUDE_SECURESTORAGE_CONFIG_DIR: void 0, ...NOT_INHERITED, ...force };
  }
  return { CLAUDE_CONFIG_DIR: loginFolder(login), CLAUDE_SECURESTORAGE_CONFIG_DIR: void 0, ...NOT_INHERITED, ...force };
}
function claudeProbeEnv(login) {
  if (login.machineOwn) {
    return { CLAUDE_CONFIG_DIR: ownClaudeProbeFolder(), CLAUDE_SECURESTORAGE_CONFIG_DIR: "", ...NOT_INHERITED };
  }
  return claudeLoginEnv(login);
}
function codexLoginEnv(login, inherited = {}, platform = process.platform) {
  if (!login.machineOwn) return { CODEX_HOME: loginFolder(login), ...NOT_INHERITED };
  const windows = platform === "win32";
  const home = windows ? Object.entries(inherited).find(([name]) => name.toUpperCase() === "CODEX_HOME")?.[1] : inherited["CODEX_HOME"];
  return isKurmisCodexHome(home, providerFolder("codex"), windows) ? { CODEX_HOME: void 0, ...NOT_INHERITED } : { ...NOT_INHERITED };
}
function configDirHasOwnCredentials(env, platform = process.platform, home = (0, import_node_os2.homedir)()) {
  const value = env["CLAUDE_CONFIG_DIR"];
  if (value === void 0 || value === "") return false;
  if (platform === "darwin" || platform === "win32") return true;
  return !namesDefaultClaudeFolder(value, platform, home);
}
function namesDefaultClaudeFolder(value, platform = process.platform, home = (0, import_node_os2.homedir)()) {
  if (value === "") return false;
  const real = (path) => {
    const absolute = (0, import_node_path4.resolve)(path);
    try {
      return import_node_fs5.realpathSync.native(absolute);
    } catch {
      return absolute;
    }
  };
  const comparable = (path) => platform === "darwin" || platform === "win32" ? real(path).normalize("NFC").toLowerCase() : real(path);
  return comparable(value) === comparable((0, import_node_path4.join)(home, ".claude"));
}
function sharesDefaultSettingsFile(value, platform = process.platform, home = (0, import_node_os2.homedir)()) {
  if (value === "") return false;
  const comparable = (path) => {
    const real = realFilePath((0, import_node_path4.resolve)(path));
    return platform === "darwin" || platform === "win32" ? real.normalize("NFC").toLowerCase() : real;
  };
  return comparable((0, import_node_path4.join)(value, "settings.json")) === comparable((0, import_node_path4.join)(home, ".claude", "settings.json"));
}
function realFilePath(path, hops = 0) {
  try {
    return import_node_fs5.realpathSync.native(path);
  } catch {
  }
  if (hops < 40) {
    try {
      if ((0, import_node_fs5.lstatSync)(path).isSymbolicLink()) return realFilePath((0, import_node_path4.resolve)((0, import_node_path4.dirname)(path), (0, import_node_fs5.readlinkSync)(path)), hops + 1);
    } catch {
    }
  }
  const parent = (0, import_node_path4.dirname)(path);
  return parent === path ? path : (0, import_node_path4.join)(realFilePath(parent, hops + 1), (0, import_node_path4.basename)(path));
}
function applyEnvPatch(env, patch, windows = process.platform === "win32") {
  const same2 = (a, b) => windows ? a.toUpperCase() === b.toUpperCase() : a === b;
  const names = Object.keys(patch);
  const out = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === void 0 || names.some((other) => same2(name, other))) continue;
    out[name] = value;
  }
  for (const [name, value] of Object.entries(patch)) {
    if (value !== void 0) out[name] = value;
  }
  return out;
}

// src/platform/programs.ts
var import_node_fs8 = require("node:fs");
var import_node_path8 = require("node:path");

// src/platform/detach.ts
var import_node_child_process = require("node:child_process");
var import_node_fs7 = require("node:fs");
var import_node_os3 = require("node:os");
var import_node_path6 = require("node:path");

// src/platform/system-program-guard.ts
var import_node_fs6 = require("node:fs");
var import_node_path5 = require("node:path");
var GUARD_VARIABLE = "KURMIS_REFUSE_SYSTEM_PROGRAMS";
var REFUSAL_LOG_VARIABLE = "KURMIS_REFUSED_PROGRAMS_LOG";
var GUARDED_PROGRAMS = /* @__PURE__ */ new Set([
  "launchctl",
  "security",
  "powershell",
  "pwsh",
  "reg",
  "taskkill",
  "wscript",
  "cscript",
  "wmic",
  "schtasks",
  "cmd",
  "claude",
  "codex"
]);
function guardOn(env) {
  return process.env[GUARD_VARIABLE] === "1" || env?.[GUARD_VARIABLE] === "1";
}
var REAL_CLI_PATHS = [
  /\/@anthropic-ai\/claude-code[^/]*\//,
  /\/@openai\/codex[^/]*\//,
  /\/\.local\/share\/claude\/versions\//
];
var TEST_HOME_VARIABLES = [
  "HOME",
  "USERPROFILE",
  "KURMIS_HOME",
  "KURMIS_CLAUDE_BIN",
  "KURMIS_CODEX_BIN",
  "KURMIS_UPSTREAM_URL"
];
function refusedByGuard(command, env, args = []) {
  if (!guardOn(env)) return null;
  let refused = isRealProgram(command);
  if (!refused && isNode(command)) {
    const script = args.find((arg) => !arg.startsWith("-"));
    refused = script !== void 0 && isRealProgram(script);
  }
  if (!refused) return null;
  const shown = isRealProgram(command) ? command : `${command} ${args.join(" ")}`;
  recordRefusal(shown, env);
  return `${shown} is a real system program, which kurmis does not start while ${GUARD_VARIABLE}=1 (tests)`;
}
function pathsOf(path) {
  const paths = [path.replaceAll("\\", "/")];
  try {
    const real = (0, import_node_fs6.realpathSync)(path).replaceAll("\\", "/");
    if (real !== paths[0]) paths.push(real);
  } catch {
  }
  return paths;
}
function isRealProgram(path) {
  return pathsOf(path).some((each) => {
    const name = (0, import_node_path5.basename)(each).toLowerCase().replace(/\.exe$/, "");
    const lower = each.toLowerCase();
    return GUARDED_PROGRAMS.has(name) || REAL_CLI_PATHS.some((pattern) => pattern.test(lower));
  });
}
function isNode(command) {
  if (command === process.execPath) return true;
  return pathsOf(command).some((each) => /^node(\.exe)?$/i.test((0, import_node_path5.basename)(each)));
}
function refusalLog(env) {
  const named = env?.[REFUSAL_LOG_VARIABLE] || process.env[REFUSAL_LOG_VARIABLE];
  return named === void 0 || named === "" ? void 0 : named;
}
function recordRefusal(command, env) {
  const log = refusalLog(env);
  if (log === void 0) return;
  try {
    (0, import_node_fs6.appendFileSync)(log, `${command}
`, "utf8");
  } catch {
  }
}
function withGuard(env) {
  if (!guardOn(env)) return env;
  const log = refusalLog(env);
  const out = { ...env ?? process.env, [GUARD_VARIABLE]: "1", ...log === void 0 ? {} : { [REFUSAL_LOG_VARIABLE]: log } };
  for (const name of TEST_HOME_VARIABLES) {
    const value = process.env[name];
    if (!hasVariable(out, name) && value !== void 0 && value !== "") out[name] = value;
  }
  return out;
}
function hasVariable(env, name) {
  const upper = name.toUpperCase();
  return Object.keys(env).some((key) => key.toUpperCase() === upper && env[key] !== void 0);
}

// src/platform/detach.ts
var ENTRY_VARIABLE = "KURMIS_ENTRY";
function bundleFile() {
  const file = typeof __filename === "string" ? __filename : null;
  return file !== null && /\.c?js$/i.test(file) ? file : null;
}
function kurmisEntry(options = {}) {
  const env = options.env ?? process.env;
  const named = env[ENTRY_VARIABLE];
  if (named !== void 0 && named !== "") return named;
  const file = options.moduleFile === void 0 ? bundleFile() : options.moduleFile;
  if (file === null) return null;
  try {
    return (0, import_node_fs7.realpathSync)(file);
  } catch {
    return file;
  }
}
function temporaryFolders(env = process.env, platform = process.platform) {
  const named = ["TMPDIR", "TEMP", "TMP"].map((name) => platform === "win32" ? windowsEnv(env, name) : env[name]);
  const fixed = platform === "win32" ? [] : ["/tmp", "/private/tmp", "/var/folders", "/private/var/folders"];
  return [...new Set([(0, import_node_os3.tmpdir)(), ...named, ...fixed].filter((folder) => folder !== void 0 && folder !== ""))];
}
function isTemporaryPath(path, folders, platform) {
  const separators = platform === "win32" ? /[\\/]+/ : /\/+/;
  const fold = (text2) => platform === "win32" ? text2.toLowerCase() : text2;
  if (path.split(separators).some((part) => fold(part) === "fnm_multishells")) return true;
  const join17 = platform === "win32" ? "\\" : "/";
  const plain = fold(path.split(separators).join(join17));
  return folders.some((folder) => {
    const root = fold(folder.split(separators).join(join17)).replace(/[\\/]+$/, "");
    return root !== "" && (plain === root || plain.startsWith(root + join17));
  });
}
function nodeForJobs(options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const execPath = options.execPath ?? process.execPath;
  const realpath = options.realpath ?? import_node_fs7.realpathSync;
  const temporary = options.temporaryFolders ?? temporaryFolders(env, platform);
  let target;
  try {
    target = realpath(execPath);
  } catch {
    return execPath;
  }
  const running = isTemporaryPath(execPath, temporary, platform) && !isTemporaryPath(target, temporary, platform) ? target : execPath;
  const windows = platform === "win32";
  const folders = windows ? windowsPathFolders(windowsEnv(env, "PATH")) : posixPathFolders(env.PATH);
  for (const folder of folders) {
    const candidate = windows ? import_node_path6.win32.join(folder, "node.exe") : import_node_path6.posix.join(folder, "node");
    try {
      if (!(0, import_node_fs7.statSync)(candidate).isFile()) continue;
    } catch {
      continue;
    }
    if (isTemporaryPath(candidate, temporary, platform)) continue;
    try {
      return realpath(candidate) === target ? candidate : running;
    } catch {
      continue;
    }
  }
  return running;
}
function spawnDetached(start2) {
  return new Promise((resolve8, reject) => {
    const guarded = refusedByGuard(start2.command, start2.env, start2.args);
    if (guarded !== null) {
      reject(new Error(guarded));
      return;
    }
    const child2 = (0, import_node_child_process.spawn)(start2.command, [...start2.args], {
      detached: true,
      stdio: "ignore",
      env: withGuard(start2.env),
      cwd: start2.cwd,
      shell: false,
      windowsHide: true
    });
    const exited = new Promise((done) => {
      child2.once("exit", (code) => done(code));
    });
    child2.once("error", (error) => {
      if (child2.pid === void 0) reject(error);
    });
    child2.once("spawn", () => {
      child2.unref();
      if (child2.pid === void 0) reject(new Error(`${start2.command} could not be started`));
      else resolve8({ pid: child2.pid, exited });
    });
  });
}
function windowsCommandLine(argv) {
  return argv.map(quoteWindowsArgument).join(" ");
}
function quoteWindowsArgument(arg) {
  if (arg !== "" && !/[\s"]/.test(arg)) return arg;
  let out = '"';
  let backslashes = 0;
  for (const char of arg) {
    if (char === "\\") {
      backslashes++;
      continue;
    }
    if (char === '"') out += "\\".repeat(backslashes * 2 + 1) + '"';
    else out += "\\".repeat(backslashes) + char;
    backslashes = 0;
  }
  return `${out}${"\\".repeat(backslashes * 2)}"`;
}

// src/platform/npm-shim.ts
var import_node_path7 = require("node:path");
function decodeCmdShim(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
function parseCmdShim(text2, shimPath) {
  const folder = import_node_path7.win32.dirname(import_node_path7.win32.resolve(shimPath));
  const lines = text2.split(/\r?\n/).map((line) => line.trim());
  const progValues = lines.map((line) => /^@?set\s+"_prog=([^"]*)"$/i.exec(line)?.[1]).filter((value) => value !== void 0);
  const runLines = [];
  for (const line of lines) {
    if (!/(^|\s)%\*$/.test(line)) continue;
    const command = lastCommand(line.replace(/^@/, ""));
    const tokens = tokenize(command);
    if (tokens === null) return { unreadable: `the line ${JSON.stringify(line)} is not a plain command` };
    tokens.pop();
    const [program, ...rest] = tokens;
    if (program === void 0) return { unreadable: `the line ${JSON.stringify(line)} names no program` };
    const programs = /^@?%_prog%$/i.test(program) ? progValues : [program.replace(/^@/, "")];
    if (programs.length === 0) return { unreadable: "the shim starts %_prog% but never sets it" };
    runLines.push({ programs, rest });
  }
  if (runLines.length === 0) return { unreadable: "no line passes the arguments on (%*)" };
  let shim = null;
  for (const run2 of runLines) {
    const reading = readRunLine(run2, folder);
    if ("unreadable" in reading) return reading;
    if (shim === null) {
      shim = reading;
      continue;
    }
    if (!sameCall(shim, reading)) return { unreadable: "its lines start different programs" };
    for (const interpreter of reading.interpreters) {
      if (!shim.interpreters.includes(interpreter)) shim.interpreters.push(interpreter);
    }
  }
  return shim;
}
function cmdShimInvocation(shim, options) {
  if (/\.(cmd|bat)$/i.test(shim.target)) {
    return { refused: `${shim.target} is a batch file, which only cmd.exe can start` };
  }
  if (shim.interpreters.length === 0) {
    if (!/\.(exe|com)$/i.test(shim.target)) {
      return { refused: `the shim starts ${shim.target} directly, and that is not an .exe` };
    }
    return { command: shim.target, args: [...shim.targetArgs] };
  }
  for (const interpreter of shim.interpreters) {
    const command = isAbsoluteWindowsPath(interpreter) ? options.isFile(interpreter) ? interpreter : null : /^node(\.exe)?$/i.test(interpreter) ? options.nodePath : null;
    if (command !== null) {
      return { command, args: [...shim.interpreterArgs, shim.target, ...shim.targetArgs] };
    }
  }
  return { refused: `the shim starts ${shim.target} with ${shim.interpreters.join(" or ")}, which kurmis does not start` };
}
function isAbsoluteWindowsPath(path) {
  return /^[a-z]:\\/i.test(path) || path.startsWith("\\\\");
}
function readRunLine(run2, folder) {
  const expanded = [];
  for (const program of run2.programs) {
    const value = expand(program, folder);
    if (value === null) return { unreadable: `it starts ${program}, which is neither an absolute path nor a program name` };
    expanded.push(value);
  }
  if (run2.rest.length === 0) {
    const [target2] = expanded;
    if (expanded.length !== 1 || target2 === void 0 || !isAbsoluteWindowsPath(target2)) {
      return { unreadable: "it starts no file by its path" };
    }
    return { target: target2, interpreters: [], interpreterArgs: [], targetArgs: [] };
  }
  const targetIndex = run2.rest.findIndex((token) => /%~dp0|%dp0%/i.test(token) || isAbsoluteWindowsPath(token));
  if (targetIndex < 0) return { unreadable: "it starts no file by its path" };
  const rest = [];
  for (const token of run2.rest) {
    const value = expand(token, folder);
    if (value === null) return { unreadable: `it uses ${token}, which kurmis cannot work out` };
    rest.push(value);
  }
  const target = rest[targetIndex];
  if (!isAbsoluteWindowsPath(target)) return { unreadable: `its target ${run2.rest[targetIndex]} is not an absolute path` };
  return {
    target,
    interpreters: expanded,
    interpreterArgs: rest.slice(0, targetIndex),
    targetArgs: rest.slice(targetIndex + 1)
  };
}
function expand(token, folder) {
  let otherVariable = false;
  const replaced = token.replace(/%%|%~dp0|%dp0%|%/gi, (match) => {
    if (match === "%%") return "%";
    if (match === "%") {
      otherVariable = true;
      return match;
    }
    return `${folder}\\`;
  });
  if (otherVariable) return null;
  if (isAbsoluteWindowsPath(replaced)) return import_node_path7.win32.normalize(replaced);
  if (replaced.includes("\\") || replaced.includes("/")) return null;
  return replaced;
}
function lastCommand(line) {
  let quoted = false;
  let start2 = 0;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') quoted = !quoted;
    else if (char === "&" && !quoted) start2 = i + 1;
  }
  return line.slice(start2).trim();
}
function tokenize(command) {
  const tokens = [];
  for (const match of command.matchAll(/"([^"]*)"|([^\s"]+)/g)) {
    const quoted = match[1];
    const bare = match[2];
    if (bare !== void 0 && /[|<>^()]/.test(bare)) return null;
    tokens.push(quoted ?? bare ?? "");
  }
  return tokens;
}
function sameCall(a, b) {
  return a.target === b.target && a.interpreters.length === 0 === (b.interpreters.length === 0) && a.interpreterArgs.join("\0") === b.interpreterArgs.join("\0") && a.targetArgs.join("\0") === b.targetArgs.join("\0");
}

// src/platform/run.ts
var import_node_child_process2 = require("node:child_process");
var import_node_timers = require("node:timers");
var DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
function invocationFor(program, args, nodePath = process.execPath) {
  if (/\.(cmd|bat)$/i.test(program)) {
    return { refused: `${program} is a batch file, which only cmd.exe can start; kurmis never starts a program through a shell` };
  }
  if (/\.(js|cjs|mjs)$/i.test(program)) return { command: nodePath, args: [program, ...args] };
  return { command: program, args: [...args] };
}
function runProgram(program, args, options) {
  const invocation = invocationFor(program, args);
  if ("refused" in invocation) {
    return Promise.resolve({ stdout: "", stderr: "", code: null, timedOut: false, outputTooLarge: false, error: invocation.refused });
  }
  const guarded = refusedByGuard(invocation.command, options.env, invocation.args);
  if (guarded !== null) {
    return Promise.resolve({ stdout: "", stderr: "", code: null, timedOut: false, outputTooLarge: false, error: guarded });
  }
  const cap = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  let child2;
  try {
    child2 = (0, import_node_child_process2.spawn)(invocation.command, invocation.args, {
      // Standard input is closed, so a program that reads it gets end-of-file at once rather
      // than waiting on a terminal until the deadline.
      stdio: ["ignore", "pipe", "pipe"],
      env: withGuard(options.env ?? process.env),
      cwd: options.cwd,
      shell: false,
      windowsHide: true
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return Promise.resolve({
      stdout: "",
      stderr: "",
      code: null,
      timedOut: false,
      outputTooLarge: false,
      error: `${program} could not be started: ${reason}`
    });
  }
  return new Promise((resolve8) => {
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let outputTooLarge = false;
    let settled = false;
    const finish = (code, error) => {
      if (settled) return;
      settled = true;
      (0, import_node_timers.clearTimeout)(timer);
      resolve8({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        code,
        timedOut,
        outputTooLarge,
        error
      });
    };
    const kill = () => {
      child2.kill("SIGKILL");
      child2.stdout.destroy();
      child2.stderr.destroy();
    };
    const timer = (0, import_node_timers.setTimeout)(() => {
      timedOut = true;
      kill();
    }, options.timeoutMs);
    const keep = (chunks, chunk, kept) => {
      if (outputTooLarge || timedOut) return kept;
      if (kept + chunk.length > cap) {
        chunks.push(chunk.subarray(0, cap - kept));
        outputTooLarge = true;
        kill();
        return cap;
      }
      chunks.push(chunk);
      return kept + chunk.length;
    };
    child2.stdout.on("data", (chunk) => {
      stdoutBytes = keep(stdout, chunk, stdoutBytes);
    });
    child2.stderr.on("data", (chunk) => {
      stderrBytes = keep(stderr, chunk, stderrBytes);
    });
    child2.on("error", (error) => {
      if (child2.pid === void 0) finish(null, `${program} could not be started: ${error.message}`);
    });
    child2.on("close", (code, signal) => {
      if (timedOut) finish(null, `${program} did not finish within ${String(options.timeoutMs)} ms and was killed`);
      else if (outputTooLarge) finish(null, `${program} printed more than ${String(cap)} bytes and was killed`);
      else if (code === null) finish(null, `${program} was ended by ${signal ?? "a signal"}`);
      else finish(code, null);
    });
  });
}

// src/platform/programs.ts
var ProgramNotFoundError = class extends Error {
  constructor(tool, message) {
    super(message);
    this.tool = tool;
    this.name = "ProgramNotFoundError";
  }
  tool;
};
var PROGRAM_VARIABLES = {
  claude: "KURMIS_CLAUDE_BIN",
  codex: "KURMIS_CODEX_BIN"
};
var TOOL_NAMES = {
  claude: "Claude Code",
  codex: "Codex"
};
var DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";
var MAX_SHIM_BYTES = 64 * 1024;
function findProgram(tool, options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const nodePath = options.nodePath ?? process.execPath;
  const files = options.files ?? realFiles;
  const variable = PROGRAM_VARIABLES[tool];
  const named = namedProgram(env, variable, platform);
  if (named !== void 0) {
    const invocation = invocationFor(named, [], nodePath);
    if ("refused" in invocation) throw new ProgramNotFoundError(tool, `${variable}: ${invocation.refused}`);
    return { command: invocation.command, args: invocation.args, source: "env" };
  }
  const ownEntry = options.ownEntry === void 0 ? kurmisEntry({ env }) : options.ownEntry;
  const own2 = ownEntry === null ? null : files.realPath(ownEntry) ?? ownEntry;
  return platform === "win32" ? findOnWindows(tool, env, nodePath, files, own2) : findOnPosix(tool, env, nodePath, files, own2);
}
function namedProgram(env, variable, platform) {
  const own2 = platform === "win32" ? windowsEnv(env, variable) : env[variable];
  if (own2 !== void 0 && own2 !== "") return own2;
  if (!guardOn(env) || hasVariable(env, variable)) return void 0;
  const inherited = process.env[variable];
  return inherited === void 0 || inherited === "" ? void 0 : inherited;
}
var OWN_BUNDLE = "it is kurmis itself, not the real program";
function findOnPosix(tool, env, nodePath, files, own2) {
  const folders = posixPathFolders(env.PATH);
  const skipped = [];
  for (const folder of folders) {
    const candidate = import_node_path8.posix.join(folder, tool);
    if (!files.isExecutable(candidate)) continue;
    const real = files.realPath(candidate);
    if (own2 !== null && real === own2) {
      skipped.push(`${candidate}: ${OWN_BUNDLE}`);
      continue;
    }
    if (real !== null && /\.(js|cjs|mjs)$/i.test(real)) return { command: nodePath, args: [real], source: "path" };
    return { command: candidate, args: [], source: "path" };
  }
  const looked = [`the ${countFolders(folders.length)} on PATH`];
  if (tool === "claude" && env.HOME !== void 0 && import_node_path8.posix.isAbsolute(env.HOME)) {
    const native = import_node_path8.posix.join(env.HOME, ".local", "bin", "claude");
    if (files.isExecutable(native) && (own2 === null || files.realPath(native) !== own2)) {
      return { command: native, args: [], source: "native-installer" };
    }
    looked.push(native);
  }
  throw notFound(tool, looked, skipped);
}
function findOnWindows(tool, env, nodePath, files, own2) {
  const folders = windowsPathFolders(windowsEnv(env, "PATH"));
  const extensions = pathExtensions(windowsEnv(env, "PATHEXT"));
  const skipped = [];
  const isOwn = (path) => own2 !== null && path !== void 0 && (files.realPath(path) ?? path).toLowerCase() === own2.toLowerCase();
  for (const folder of folders) {
    for (const extension of extensions) {
      const candidate = import_node_path8.win32.join(folder, tool + extension);
      if (!files.isFile(candidate)) continue;
      if (extension === ".exe" || extension === ".com") return { command: candidate, args: [], source: "path" };
      const resolved = resolveShim(tool, candidate, nodePath, files);
      if ("refused" in resolved) skipped.push(`${candidate}: ${resolved.refused}`);
      else if (isOwn(resolved.args[0])) skipped.push(`${candidate}: ${OWN_BUNDLE}`);
      else return resolved;
    }
  }
  const looked = [`the ${countFolders(folders.length)} on PATH (as ${extensions.map((extension) => tool + extension).join(", ")})`];
  const home = windowsEnv(env, "USERPROFILE");
  if (tool === "claude" && home !== void 0 && isAbsoluteWindowsPath(home)) {
    const native = import_node_path8.win32.join(home, ".local", "bin", "claude.exe");
    if (files.isFile(native)) return { command: native, args: [], source: "native-installer" };
    looked.push(native);
  }
  throw notFound(tool, looked, skipped);
}
function resolveShim(tool, shimPath, nodePath, files) {
  const bytes = files.read(shimPath, MAX_SHIM_BYTES);
  if (bytes === null) return { refused: "it could not be read" };
  const text2 = decodeCmdShim(bytes);
  if (text2 === null) return { refused: "it is not a package manager shim kurmis can read (it is not UTF-8 text)" };
  const shim = parseCmdShim(text2, shimPath);
  if ("unreadable" in shim) return { refused: `it is not a package manager shim kurmis can read (${shim.unreadable})` };
  if (!files.isFile(shim.target)) return { refused: `it starts ${shim.target}, which does not exist` };
  const invocation = cmdShimInvocation(shim, { nodePath, isFile: (path) => files.isFile(path) });
  if ("refused" in invocation) return invocation;
  if (invocation.command === shim.target && !startsLikeWindowsProgram(files, shim.target)) {
    const wrapper = import_node_path8.win32.join(import_node_path8.win32.dirname(import_node_path8.win32.dirname(shim.target)), "cli-wrapper.cjs");
    if (tool === "claude" && files.isFile(wrapper)) {
      return { command: nodePath, args: [wrapper, ...invocation.args], source: "npm-shim" };
    }
    return {
      refused: `it starts ${shim.target}, which is not a Windows program; if this is the npm package, its install step did not run (reinstall it without --ignore-scripts)`
    };
  }
  return { command: invocation.command, args: invocation.args, source: "npm-shim" };
}
function startsLikeWindowsProgram(files, path) {
  const head = files.read(path, 2);
  return head !== null && head[0] === 77 && head[1] === 90;
}
function notFound(tool, looked, skipped) {
  const lines = [`${TOOL_NAMES[tool]} (${tool}) was not found. Looked in ${looked.join(" and at ")}.`];
  if (skipped.length > 0) lines.push(`Skipped:
${skipped.map((line) => `  ${line}`).join("\n")}`);
  lines.push(`Install ${TOOL_NAMES[tool]}, or set ${PROGRAM_VARIABLES[tool]} to the full path of the program.`);
  return new ProgramNotFoundError(tool, lines.join("\n"));
}
function countFolders(count) {
  return count === 1 ? "1 folder" : `${String(count)} folders`;
}
function posixPathFolders(value) {
  return (value ?? "").split(":").filter((folder) => folder !== "" && import_node_path8.posix.isAbsolute(folder));
}
function windowsPathFolders(value) {
  return (value ?? "").split(";").map((folder) => folder.trim().replace(/^"(.*)"$/, "$1")).filter((folder) => isAbsoluteWindowsPath(folder));
}
function pathExtensions(value) {
  const listed = (value === void 0 || value.trim() === "" ? DEFAULT_PATHEXT : value).split(";").map((extension) => extension.trim().toLowerCase());
  return [...new Set(listed)].filter((extension) => [".com", ".exe", ".bat", ".cmd"].includes(extension));
}
function windowsEnv(env, name) {
  const exact = env[name];
  if (exact !== void 0 && exact !== "") return exact;
  const upper = name.toUpperCase();
  for (const [key, value] of Object.entries(env)) {
    if (key.toUpperCase() === upper && value !== void 0 && value !== "") return value;
  }
  return exact;
}
function regularFile(path) {
  try {
    return (0, import_node_fs8.statSync)(path, { throwIfNoEntry: false })?.isFile() ?? false;
  } catch {
    return false;
  }
}
var realFiles = {
  isFile(path) {
    return regularFile(path);
  },
  isExecutable(path) {
    if (!regularFile(path)) return false;
    try {
      (0, import_node_fs8.accessSync)(path, import_node_fs8.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  },
  realPath(path) {
    try {
      return (0, import_node_fs8.realpathSync)(path);
    } catch {
      return null;
    }
  },
  read(path, maxBytes) {
    let fd;
    try {
      fd = (0, import_node_fs8.openSync)(path, "r");
    } catch {
      return null;
    }
    try {
      const buffer = Buffer.alloc(maxBytes);
      const length = (0, import_node_fs8.readSync)(fd, buffer, 0, maxBytes, 0);
      return buffer.subarray(0, length);
    } catch {
      return null;
    } finally {
      (0, import_node_fs8.closeSync)(fd);
    }
  }
};

// src/cli/codex-home-files.ts
var import_node_crypto6 = require("node:crypto");
var import_node_fs9 = require("node:fs");
var import_promises4 = require("node:fs/promises");
var import_promises5 = require("node:timers/promises");
var import_node_os4 = require("node:os");
var import_node_path11 = require("node:path");

// src/core/codex-home.ts
var import_node_path9 = require("node:path");

// src/core/codex-account-config.ts
var import_toml_eslint_parser = __toESM(require_lib(), 1);
var SECRET_TABLES = /* @__PURE__ */ new Set(["env", "set", "http_headers", "headers", "query_params"]);
var SECRET_LAST_WORDS = /* @__PURE__ */ new Set(["token", "secret", "secrets", "password", "passwd", "passphrase", "authorization", "cookie", "apikey"]);
var PUBLIC_KEY_WORDS = /* @__PURE__ */ new Set(["env", "public"]);
var PUBLIC_NAMES = /* @__PURE__ */ new Set(["client-private-key"]);
function keyWords(key) {
  return key.replace(/([a-z\d])([A-Z])/g, "$1_$2").toLowerCase().split(/[^a-z\d]+/).filter((word) => word.length > 0);
}
function secretKeyName(key) {
  const lower = key.toLowerCase();
  if (SECRET_TABLES.has(lower)) return true;
  if (PUBLIC_NAMES.has(lower)) return false;
  const words = keyWords(key);
  const last = words.at(-1);
  if (last === void 0) return false;
  if (SECRET_LAST_WORDS.has(last)) return true;
  return last === "key" && !PUBLIC_KEY_WORDS.has(words.at(-2) ?? "");
}
var SECRET_TEXT = /(?:\bBearer\s+\S+|\b(?:sk|ghp|github_pat|xox[baprs])[-_][a-z\d_-]{8,}|-----BEGIN [\w ]*PRIVATE KEY-----|https?:\/\/[^\s/@:]*:[^\s/@]+@|[?&](?:token|key|secret|signature|password)=[^&#\s]+|(?:api[_-]?key|secret|password|authorization|access[_-]?token)\s*[=:]\s*["']?[^\s,"'}]+)/i;
function secretLooking(text2) {
  return SECRET_TEXT.test(text2) || /--(?:token|api-key|password|secret)(?:[=\s]+)\S+/i.test(text2);
}
function secretArguments(value) {
  return value.some((arg) => typeof arg === "string" && /^(?:-H|--(?:env|header|headers|token|api-key|password|secret|authorization))(?:=|$)/i.test(arg));
}
var TRUST_TABLES = [
  { parent: ["projects"], fields: ["trust_level"] },
  { parent: ["hooks", "state"], fields: ["trusted_hash", "trusted_content_hash", "enabled"] }
];
function trustNameIndex(path) {
  for (const { parent } of TRUST_TABLES) {
    if (path.length >= parent.length + 2 && parent.every((key, index) => path[index] === key)) return parent.length;
  }
  return -1;
}
function trustValue(path) {
  for (const { parent, fields } of TRUST_TABLES) {
    if (path.length === parent.length + 2 && parent.every((key, index) => path[index] === key) && fields.includes(path.at(-1))) return true;
  }
  return false;
}
var NAMED_TABLES = /* @__PURE__ */ new Set(["mcp_servers", "model_providers", "profiles"]);
function nameIndex(path) {
  const trust = trustNameIndex(path);
  if (trust !== -1) return trust;
  return path.length >= 3 && typeof path[0] === "string" && NAMED_TABLES.has(path[0]) ? 1 : -1;
}
function secretPath(path) {
  const name = nameIndex(path);
  return path.some((key, index) => index !== name && typeof key === "string" && secretKeyName(key));
}
function secretValue(value, named) {
  if (typeof value === "string") return named || secretLooking(value);
  if (Array.isArray(value)) return secretArguments(value) || value.some((item) => secretValue(item, named));
  if (isTable(value)) return Object.entries(value).some(([key, child2]) => secretValue(child2, named || secretKeyName(key)));
  return false;
}
function secretSetting(path, value) {
  return secretValue(value, secretPath(path));
}
var MASK = /* @__PURE__ */ Symbol("secret");
function masked(value, named) {
  if (typeof value === "string") return named || secretLooking(value) ? MASK : value;
  if (Array.isArray(value)) return secretArguments(value) ? MASK : value.map((item) => masked(item, named));
  if (!isTable(value)) return value;
  const out = dict();
  for (const [key, child2] of Object.entries(value)) out[key] = masked(child2, named || secretKeyName(key));
  return out;
}
var TomlScalar = class {
  kind;
  text;
  constructor(kind, text2) {
    this.kind = kind;
    this.text = text2;
  }
};
function floatText(value) {
  if (Number.isNaN(value)) return "nan";
  if (!Number.isFinite(value)) return value > 0 ? "inf" : "-inf";
  if (Object.is(value, -0)) return "-0.0";
  const text2 = String(value);
  return /[.e]/.test(text2) ? text2 : `${text2}.0`;
}
function scalar(node) {
  switch (node.kind) {
    case "string":
    case "boolean":
      return node.value;
    case "integer":
      return new TomlScalar("integer", node.bigint.toString());
    case "float":
      return new TomlScalar("float", floatText(node.value));
    default:
      return new TomlScalar(node.kind, node.datetime.replace(/^(\d{4}-\d{2}-\d{2})[ t]/i, "$1T").toUpperCase());
  }
}
function isTable(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof TomlScalar);
}
function dict() {
  return /* @__PURE__ */ Object.create(null);
}
function own(value, key) {
  return isTable(value) && Object.hasOwn(value, key) ? value[key] : void 0;
}
function record(value) {
  return isTable(value) ? value : dict();
}
function at(root, path) {
  return path.reduce((value, key) => typeof key === "number" ? Array.isArray(value) ? value[key] : void 0 : own(value, key), root);
}
function setAt(root, path, value) {
  let table = root;
  for (const key of path.slice(0, -1)) {
    if (!isTable(own(table, key))) table[key] = dict();
    table = table[key];
  }
  table[path.at(-1)] = value;
}
function removeAt(root, path) {
  const parent = at(root, path.slice(0, -1));
  if (isTable(parent) && Object.hasOwn(parent, path.at(-1))) delete parent[path.at(-1)];
}
function copyTables(value) {
  if (!isTable(value)) return value;
  const out = dict();
  for (const [key, child2] of Object.entries(value)) out[key] = copyTables(child2);
  return out;
}
function stableJson(value) {
  if (value === MASK) return '"<secret>"';
  if (value instanceof TomlScalar) return `${value.kind}:${JSON.stringify(value.text)}`;
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
function same(a, b) {
  return stableJson(a) === stableJson(b);
}
function settingsOf(value, base = []) {
  return Object.entries(record(value)).flatMap(([key, child2]) => isTable(child2) ? settingsOf(child2, [...base, key]) : [{ path: [...base, key], value: child2 }]);
}
function tablePaths(value, base = []) {
  return Object.entries(record(value)).flatMap(([key, child2]) => isTable(child2) ? [[...base, key], ...tablePaths(child2, [...base, key])] : []);
}
function holdsOrdinarySetting(value, path) {
  return settingsOf(value, path).some((setting) => !secretSetting(setting.path, setting.value));
}
function withoutEmptyTables(value) {
  if (!isTable(value)) return value;
  const out = dict();
  for (const [key, child2] of Object.entries(value)) {
    const kept = withoutEmptyTables(child2);
    if (!isTable(kept) || Object.keys(kept).length > 0) out[key] = kept;
  }
  return out;
}
function withoutBom(text2) {
  return text2.charCodeAt(0) === 65279 ? text2.slice(1) : text2;
}
function parseToml(text2) {
  try {
    return (0, import_toml_eslint_parser.parseTOML)(text2, { tomlVersion: "1.0" });
  } catch {
    throw new Error("config.toml is not valid TOML");
  }
}
function keyParts(key) {
  return key.keys.map((part) => part.type === "TOMLBare" ? part.name : part.value);
}
function tableValue(ast, convert) {
  const child2 = (table, key) => {
    if (!Object.hasOwn(table, key)) table[key] = dict();
    return table[key];
  };
  const put = (table, keys, value) => {
    let into = table;
    for (const key of keys.slice(0, -1)) into = child2(into, key);
    into[keys.at(-1)] = value;
  };
  const content = (node) => {
    if (node.type === "TOMLArray") return node.elements.map(content);
    if (node.type !== "TOMLInlineTable") return convert(node);
    const table = dict();
    for (const entry of node.body) put(table, keyParts(entry.key), content(entry.value));
    return table;
  };
  const root = dict();
  for (const node of ast.body[0].body) {
    if (node.type === "TOMLKeyValue") {
      put(root, keyParts(node.key), content(node.value));
      continue;
    }
    let table = root;
    node.resolvedKey.forEach((key, index) => {
      if (typeof key === "number") {
        const list = table;
        table = list[key] ??= dict();
        return;
      }
      const parent = table;
      if (!Object.hasOwn(parent, key)) parent[key] = typeof node.resolvedKey[index + 1] === "number" ? [] : dict();
      table = parent[key];
    });
    for (const entry of node.body) put(table, keyParts(entry.key), content(entry.value));
  }
  return root;
}
function tomlValue(text2) {
  return tableValue(parseToml(withoutBom(text2)), (node) => node.value);
}
function typedValue(ast) {
  return tableValue(ast, scalar);
}
function typedToml(text2) {
  return typedValue(parseToml(text2));
}
function valueTexts(text2, ast) {
  const out = /* @__PURE__ */ new Map();
  const visit = (node, base) => {
    const path = [...base, ...keyParts(node.key)];
    if (node.value.type === "TOMLInlineTable") {
      for (const child2 of node.value.body) visit(child2, path);
    } else if (node.value.type === "TOMLValue") {
      out.set(JSON.stringify(path), { text: text2.slice(node.value.range[0], node.value.range[1]), value: scalar(node.value) });
    }
  };
  for (const node of ast.body[0].body) {
    if (node.type === "TOMLKeyValue") visit(node, []);
    else if (!node.resolvedKey.some((key) => typeof key === "number")) {
      for (const child2 of node.body) visit(child2, node.resolvedKey);
    }
  }
  return out;
}
function tomlLiteral(value) {
  if (typeof value === "string") return JSON.stringify(value).replace(/\u007f/g, "\\u007f");
  if (typeof value === "boolean") return String(value);
  if (value instanceof TomlScalar) return value.text;
  if (Array.isArray(value)) return `[${value.map(tomlLiteral).join(", ")}]`;
  if (value !== null && typeof value === "object") return `{ ${Object.entries(value).map(([k, v]) => `${tomlKey(k)} = ${tomlLiteral(v)}`).join(", ")} }`;
  throw new Error("config.toml holds a value that cannot be written back");
}
function tomlKey(key) {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : tomlLiteral(key);
}
function dottedKey(path) {
  return path.map((key) => tomlKey(String(key))).join(".");
}
function literalFor(path, value, texts) {
  const known = texts.get(JSON.stringify(path));
  return known !== void 0 && same(known.value, value) ? known.text : tomlLiteral(value);
}
function samePath(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
function newline(text2) {
  return text2.includes("\r\n") ? "\r\n" : "\n";
}
function lineEnd(text2, offset) {
  const end = text2.indexOf("\n", offset);
  return end < 0 ? text2.length : end + 1;
}
function lineStart(text2, offset) {
  return text2.lastIndexOf("\n", offset - 1) + 1;
}
function cutRange(text2, [start2, end]) {
  const from = lineStart(text2, start2);
  const to = lineEnd(text2, end);
  return text2.slice(from, start2).trim() === "" && /^[ \t]*(?:#[^\r\n]*)?\r?\n?$/.test(text2.slice(end, to)) ? [from, to] : [start2, end];
}
function insertLines(text2, offset, lines, nl) {
  const before = text2.slice(0, offset);
  return `${before}${before.length === 0 || before.endsWith("\n") ? "" : nl}${lines}${text2.slice(offset)}`;
}
function arrayTables(path, value, nl) {
  const header = `[[${dottedKey(path)}]]${nl}`;
  return value.map((table) => header + Object.entries(record(table)).map(([key, child2]) => `${tomlKey(key)} = ${tomlLiteral(child2)}${nl}`).join("")).join("");
}
function isArrayOfTables(value) {
  return Array.isArray(value) && value.length > 0 && value.every(isTable);
}
function rewriteInOnePass(text2, desired, texts) {
  const ast = parseToml(text2);
  const current = typedValue(ast);
  const nl = newline(text2);
  const edits = [];
  const held = /* @__PURE__ */ new Set();
  const headers = /* @__PURE__ */ new Map();
  const dotted = /* @__PURE__ */ new Map();
  const sectionEnds = /* @__PURE__ */ new Map([[JSON.stringify([]), 0]]);
  const cut = (range) => {
    const [start2, end] = cutRange(text2, range);
    edits.push({ start: start2, end, text: "" });
  };
  const visitKeyValue = (node, section) => {
    const keys = keyParts(node.key);
    const path = [...section, ...keys];
    const want = at(desired, path);
    const inline = node.value.type === "TOMLInlineTable";
    if (want === void 0 || isTable(want) && !inline) {
      cut(node.range);
      return;
    }
    for (let depth = 1; depth < keys.length; depth++) dotted.set(JSON.stringify(path.slice(0, section.length + depth)), section);
    sectionEnds.set(JSON.stringify(section), lineEnd(text2, node.range[1]));
    held.add(JSON.stringify(path));
    if (same(want, at(current, path))) return;
    edits.push({ start: node.value.range[0], end: node.value.range[1], text: inline ? tomlLiteral(want) : literalFor(path, want, texts) });
  };
  const arrays = /* @__PURE__ */ new Map();
  for (const node of ast.body[0].body) {
    if (node.type === "TOMLKeyValue") {
      visitKeyValue(node, []);
      continue;
    }
    const index = node.resolvedKey.findIndex((key) => typeof key === "number");
    if (index >= 0) {
      const path2 = node.resolvedKey.slice(0, index);
      const id = JSON.stringify(path2);
      const array = arrays.get(id) ?? { path: path2, tables: [] };
      array.tables.push(node);
      arrays.set(id, array);
      continue;
    }
    const path = node.resolvedKey;
    if (!isTable(at(desired, path))) {
      cut(node.range);
      continue;
    }
    headers.set(JSON.stringify(path), node);
    sectionEnds.set(JSON.stringify(path), lineEnd(text2, node.range[1]));
    for (const child2 of node.body) visitKeyValue(child2, path);
  }
  for (const [id, { path, tables }] of arrays) {
    const want = at(desired, path);
    if (want === void 0) {
      for (const table of tables) cut(table.range);
      continue;
    }
    held.add(id);
  }
  const isHeld = (path) => path.some((_, index) => held.has(JSON.stringify(path.slice(0, index + 1))));
  const inserts = /* @__PURE__ */ new Map();
  const insertAt = (offset, lines) => {
    inserts.set(offset, (inserts.get(offset) ?? "") + lines);
  };
  const newTables = /* @__PURE__ */ new Map();
  const appendToNewTable = (path, line) => {
    const id = JSON.stringify(path);
    const table = newTables.get(id) ?? { path, lines: "" };
    table.lines += line;
    newTables.set(id, table);
  };
  let newArrays = "";
  for (const { path, value } of settingsOf(desired)) {
    if (isHeld(path)) continue;
    if (isArrayOfTables(value)) {
      newArrays += arrayTables(path, value, nl);
      continue;
    }
    const literal = literalFor(path, value, texts);
    const parent = path.slice(0, -1);
    let placed = false;
    for (let depth = parent.length; depth >= 1 && !placed; depth--) {
      const table = parent.slice(0, depth);
      const id = JSON.stringify(table);
      const section = headers.has(id) ? table : dotted.get(id);
      if (section === void 0) continue;
      if (headers.has(id) && depth < parent.length) appendToNewTable(parent, `${tomlKey(path.at(-1))} = ${literal}${nl}`);
      else insertAt(sectionEnds.get(JSON.stringify(section)), `${dottedKey(path.slice(section.length))} = ${literal}${nl}`);
      placed = true;
    }
    if (placed) continue;
    if (parent.length === 0) insertAt(sectionEnds.get(JSON.stringify([])), `${tomlKey(path[0])} = ${literal}${nl}`);
    else appendToNewTable(parent, `${tomlKey(path.at(-1))} = ${literal}${nl}`);
  }
  const atEnd = [...newTables.values()].map(({ path, lines }) => `[${dottedKey(path)}]${nl}${lines}`).join("") + newArrays;
  if (atEnd !== "") insertAt(text2.length, atEnd);
  for (const [offset, lines] of inserts) {
    const lead = offset > 0 && text2[offset - 1] !== "\n" ? nl : "";
    edits.push({ start: offset, end: offset, text: lead + lines });
  }
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let out = text2;
  for (const { start: start2, end, text: replacement } of edits) out = out.slice(0, start2) + replacement + out.slice(end);
  return out;
}
function inArray(path) {
  return path.some((key) => typeof key === "number");
}
function tomlEntries(ast) {
  const entries = [];
  const visit = (node, base, holder) => {
    const path = [...base, ...keyParts(node.key)];
    entries.push({ path, node, holder, tables: [] });
    if (node.value.type === "TOMLInlineTable") for (const child2 of node.value.body) visit(child2, path, node.value);
  };
  for (const node of ast.body[0].body) {
    if (node.type === "TOMLKeyValue") {
      visit(node, [], null);
      continue;
    }
    const index = node.resolvedKey.findIndex((key) => typeof key === "number");
    if (index >= 0) {
      const path = node.resolvedKey.slice(0, index);
      const array = entries.find((entry) => entry.node === null && samePath(entry.path, path));
      if (array === void 0) entries.push({ path, node: null, holder: null, tables: [node] });
      else array.tables.push(node);
    }
    for (const child2 of node.body) visit(child2, [...node.resolvedKey], null);
  }
  return entries;
}
function topEntries(ast) {
  return tomlEntries(ast).filter((entry) => !inArray(entry.path));
}
function inlineEntry(entry) {
  return entry.node?.value.type === "TOMLInlineTable";
}
function entryStart(entry) {
  return entry.node?.range[0] ?? entry.tables[0].range[0];
}
function insertions(text2, ast, entries, path, value) {
  const nl = newline(text2);
  const literal = tomlLiteral(value);
  const tables = ast.body[0].body.filter((node) => node.type === "TOMLTable");
  const inTable = (depth) => {
    const rest = path.slice(depth);
    if (inArray(rest)) return null;
    const line = `${dottedKey(rest)} = ${literal}`;
    const prefix = path.slice(0, depth);
    const inline = entries.find((row) => inlineEntry(row) && samePath(row.path, prefix))?.node?.value;
    if (inline?.type === "TOMLInlineTable") {
      const last = inline.body.at(-1);
      if (last !== void 0) return `${text2.slice(0, last.range[1])}, ${line}${text2.slice(last.range[1])}`;
      const close = inline.range[1] - 1;
      return `${text2.slice(0, close)} ${line} ${text2.slice(close)}`;
    }
    if (depth === 0) return `${line}${nl}${text2}`;
    const table = tables.find((node) => samePath(node.resolvedKey, prefix));
    if (table === void 0) return null;
    return insertLines(text2, lineEnd(text2, table.range[1]), `${line}${nl}`, nl);
  };
  const parents = path.slice(0, -1);
  const candidates = [];
  if (!inArray(path) && isArrayOfTables(value)) candidates.push(insertLines(text2, text2.length, arrayTables(path, value, nl), nl));
  candidates.push(inTable(parents.length));
  if (parents.length > 0 && !inArray(path)) {
    const header = `[${dottedKey(parents)}]${nl}${tomlKey(String(path.at(-1)))} = ${literal}${nl}`;
    candidates.push(insertLines(text2, text2.length, header, nl));
  }
  for (let depth = parents.length - 1; depth >= 0; depth--) candidates.push(inTable(depth));
  return candidates.filter((candidate) => candidate !== null);
}
function leaves(value, base = []) {
  return Object.entries(record(value)).flatMap(([key, child2]) => isTable(child2) && Object.keys(child2).length > 0 ? leaves(child2, [...base, key]) : [[...base, key]]);
}
function replaceArrayOfTables(text2, path, old, value) {
  if (!Array.isArray(old) || !isArrayOfTables(value)) return null;
  const nl = newline(text2);
  const array = (current) => tomlEntries(parseToml(current)).find((entry) => entry.node === null && samePath(entry.path, path));
  let out = text2;
  try {
    for (let index = 0; index < Math.min(old.length, value.length); index++) {
      for (const leaf of leaves(old[index])) {
        if (at(value[index], leaf) !== void 0) continue;
        const row = tomlEntries(parseToml(out)).find((entry) => samePath(entry.path, [...path, index, ...leaf]));
        if (row === void 0) return null;
        out = removeEntry(out, row);
      }
      for (const leaf of leaves(value[index])) out = patchToml(out, [...path, index, ...leaf], at(value[index], leaf));
    }
    const extra = array(out)?.tables.filter((table) => table.resolvedKey[path.length] >= value.length) ?? [];
    if (extra.length > 0) out = removeEntry(out, { path: [...path], node: null, holder: null, tables: extra });
    if (value.length > old.length) {
      const tables = array(out)?.tables ?? [];
      if (tables.length === 0) return null;
      const end = lineEnd(out, Math.max(...tables.map((table) => table.range[1])));
      out = insertLines(out, end, arrayTables(path, value.slice(old.length), nl), nl);
    }
    return out;
  } catch {
    return null;
  }
}
function patchToml(text2, path, value) {
  if (path.length === 0 || secretSetting(path, value)) throw new Error("a secret cannot be copied");
  const ast = parseToml(text2);
  const literal = tomlLiteral(value);
  const current = typedValue(ast);
  const entries = tomlEntries(ast);
  const entry = entries.find((row) => samePath(row.path, path));
  if (entry && same(at(current, path), value)) return text2;
  const wanted = stableJson(withValue(current, path, value));
  const fits = (candidate) => {
    try {
      return stableJson(typedValue((0, import_toml_eslint_parser.parseTOML)(candidate, { tomlVersion: "1.0" }))) === wanted;
    } catch {
      return false;
    }
  };
  let candidates;
  if (entry?.node) candidates = [text2.slice(0, entry.node.value.range[0]) + literal + text2.slice(entry.node.value.range[1])];
  else if (entry) {
    const inPlace = replaceArrayOfTables(text2, path, at(current, path), value);
    const rest = removeEntry(text2, entry);
    const restAst = parseToml(rest);
    candidates = [...inPlace === null ? [] : [inPlace], ...insertions(rest, restAst, tomlEntries(restAst), path, value)];
  } else candidates = insertions(text2, ast, entries, path, value);
  const found = candidates.find(fits);
  if (found === void 0) throw new Error("config.toml has no place for a setting that keeps it valid TOML");
  return found;
}
function withValue(root, path, value) {
  if (path.length === 0) return value;
  const [key, ...rest] = path;
  if (typeof key === "number") {
    const list = Array.isArray(root) ? [...root] : [];
    list[key] = withValue(list[key], rest, value);
    return list;
  }
  const table = Object.assign(dict(), record(root));
  table[key] = withValue(own(root, key), rest, value);
  return table;
}
function removeEntry(text2, { node, holder, tables }) {
  if (node === null) {
    return tables.map((table) => table.range).sort((a, b) => b[0] - a[0]).reduce((out, [start3, end2]) => out.slice(0, start3) + out.slice(end2), text2);
  }
  let [start2, end] = node.range;
  if (holder !== null) {
    const index = holder.body.indexOf(node);
    if (index > 0) start2 = holder.body[index - 1].range[1];
    else if (holder.body.length > 1) end = holder.body[1].range[0];
  }
  return text2.slice(0, start2) + text2.slice(end);
}
function settle(text2, desired) {
  let out = text2;
  const now = typedToml(out);
  for (const { path, value } of settingsOf(desired).filter((setting) => !same(at(now, setting.path), setting.value))) {
    out = patchToml(out, path, value);
  }
  for (; ; ) {
    const remove = topEntries(parseToml(out)).filter((entry) => !inlineEntry(entry) && at(desired, entry.path) === void 0);
    const last = remove.sort((a, b) => entryStart(b) - entryStart(a))[0];
    if (last === void 0) break;
    out = removeEntry(out, last);
  }
  for (; ; ) {
    const table = parseToml(out).body[0].body.find((node) => node.type === "TOMLTable" && !inArray(node.resolvedKey) && !isTable(at(desired, node.resolvedKey)));
    if (table === void 0) break;
    out = out.slice(0, table.range[0]) + out.slice(table.range[1]);
  }
  return out;
}
function holds(text2, desired) {
  try {
    return same(withoutEmptyTables(typedToml(text2)), withoutEmptyTables(desired));
  } catch {
    return false;
  }
}
function rewrite(text2, desired, texts) {
  if (same(typedToml(text2), desired)) return text2;
  for (const start2 of [() => rewriteInOnePass(text2, desired, texts), () => text2]) {
    try {
      const out = settle(start2(), desired);
      if (holds(out, desired)) return out;
    } catch {
    }
  }
  throw new Error("config.toml could not be written so that it holds the merged settings");
}
function publicSettings(values) {
  const out = dict();
  for (const setting of settingsOf(values)) {
    if (!secretSetting(setting.path, setting.value)) setAt(out, setting.path, setting.value);
  }
  return out;
}
function mergedTrust(path, own2, fromDefault) {
  const field = path.at(-1);
  if (field === "enabled") return own2 === false || fromDefault === false ? false : own2;
  if (field === "trust_level") return fromDefault === "untrusted" ? fromDefault : own2;
  return own2;
}
function mergeAccountConfig(source, target, lastMerged) {
  const sourceText = withoutBom(source);
  const targetText = withoutBom(target);
  const sourceAst = parseToml(sourceText);
  const sourceValues = typedValue(sourceAst);
  const targetValues = typedToml(targetText);
  const fromSource = publicSettings(sourceValues);
  let base = null;
  if (lastMerged !== null && settingsOf(targetValues).length > 0) {
    try {
      base = typedToml(withoutBom(lastMerged));
    } catch {
      base = null;
    }
  }
  const desired = copyTables(targetValues);
  const heldBack = [];
  for (const { path, value } of settingsOf(targetValues)) {
    if (secretSetting(path, value) || at(sourceValues, path) !== void 0) continue;
    const trust = trustValue(path);
    if (base === null) {
      if (!trust) removeAt(desired, path);
      continue;
    }
    const last = at(base, path);
    if (last === void 0 || trust && !same(value, last)) continue;
    removeAt(desired, path);
  }
  for (const { path, value } of settingsOf(fromSource)) {
    const prefixSecret = path.some((_, index) => {
      const above = at(targetValues, path.slice(0, index + 1));
      return above !== void 0 && !isTable(above) && secretSetting(path.slice(0, index + 1), above);
    });
    const belowSecret = isTable(at(targetValues, path)) && !holdsOnlyOrdinary(at(targetValues, path), path);
    if (prefixSecret || belowSecret) {
      if (!same(masked(value, secretPath(path)), masked(at(targetValues, path), secretPath(path)))) heldBack.push(dottedKey(path));
      continue;
    }
    const own2 = at(targetValues, path);
    if (base !== null && (own2 === void 0 || isTable(own2))) {
      const unit = unitOf(path);
      const whole = unit !== null && at(targetValues, unit) === void 0 ? unit : path;
      const lastWhole = at(base, whole);
      if (lastWhole !== void 0 && same(at(fromSource, whole), lastWhole)) continue;
    }
    const ownValue = own2 !== void 0 && !isTable(own2) ? own2 : void 0;
    const last = base === null ? void 0 : at(base, path);
    let next = value;
    if (trustValue(path)) {
      if (ownValue !== void 0 && (last === void 0 || !same(ownValue, last))) next = mergedTrust(path, ownValue, value);
    } else if (ownValue !== void 0 && last !== void 0 && same(value, last) && !same(ownValue, last)) {
      next = ownValue;
    }
    setAt(desired, path, next);
  }
  if (base !== null) {
    for (const unit of unitPaths(targetValues)) {
      if (at(base, unit) !== void 0 && at(sourceValues, unit) === void 0) removeAt(desired, unit);
    }
  }
  for (const path of tablePaths(targetValues)) {
    if (!holdsOrdinarySetting(at(targetValues, path), path)) continue;
    const now = at(desired, path);
    if (isTable(now) && !holdsOrdinarySetting(now, path)) removeAt(desired, path);
  }
  for (const unit of unitPaths(desired)) {
    const value = at(desired, unit);
    if (!holdsOrdinarySetting(value, unit) && !UNIT_KEYS[unit[0]].some((key) => own(value, key) !== void 0)) removeAt(desired, unit);
  }
  let missingSecrets = false;
  for (const { path, value } of settingsOf(sourceValues)) {
    if (!secretSetting(path, value)) continue;
    const unit = unitOf(path);
    if (unit !== null && at(desired, unit) === void 0 && at(fromSource, unit) !== void 0) continue;
    const kept = at(desired, path);
    if (kept === void 0) missingSecrets = true;
    else if (!same(masked(value, secretPath(path)), masked(kept, secretPath(path)))) heldBack.push(dottedKey(path));
  }
  const texts = valueTexts(sourceText, sourceAst);
  return {
    content: rewrite(targetText, desired, texts),
    merged: rewrite("", fromSource, texts),
    missingSecrets,
    heldBack: [...new Set(heldBack)]
  };
}
var UNIT_TABLES = /* @__PURE__ */ new Set(["mcp_servers", "model_providers"]);
var UNIT_KEYS = { mcp_servers: ["command", "url"], model_providers: ["name"] };
function unitOf(path) {
  return path.length >= 3 && UNIT_TABLES.has(path[0]) ? path.slice(0, 2) : null;
}
function unitPaths(values) {
  return [...UNIT_TABLES].flatMap((key) => Object.entries(record(own(values, key))).filter(([, child2]) => isTable(child2)).map(([name]) => [key, name]));
}
function holdsOnlyOrdinary(value, path) {
  return settingsOf(value, path).every((setting) => !secretSetting(setting.path, setting.value));
}
function sameTomlSettings(a, b) {
  return same(typedToml(withoutBom(a)), typedToml(withoutBom(b)));
}
function validToml(text2) {
  try {
    parseToml(withoutBom(text2));
    return true;
  } catch {
    return false;
  }
}

// src/core/codex-home.ts
var CODEX_CONFIG_FILE = "config.toml";
var CODEX_AGENTS_FILES = ["AGENTS.md", "AGENTS.override.md"];
var CODEX_CONFIG_MERGE_ATTEMPTS = 3;
var PRIVATE_DIRS = /* @__PURE__ */ new Set([".tmp", "tmp"]);
function sandboxFolder(name) {
  return /^\.sandbox(?:[-_.].*)?$/i.test(name);
}
function codexPrivateName(name) {
  return /^(?:auth\.json|\.credentials\.json|secrets(?:\..*)?|\.env(?:\..*)?|vault(?:\..*)?|.*keychain.*|.*keyring.*|.*keystore.*|(?:.*[-_.])?(?:credentials?|oauth|tokens?)(?:[-_.].*)?|.*\.(?:db|sqlite|sqlite3|p12|pfx))$/i.test(name);
}
function codexHomeEntryAction(name, kind) {
  if (kind === "directory" || kind === "directory-link") return PRIVATE_DIRS.has(name) || sandboxFolder(name) || codexPrivateName(name) ? "skip" : "link";
  if (kind !== "file") return "skip";
  if (name === CODEX_CONFIG_FILE) return "merge";
  if (CODEX_AGENTS_FILES.includes(name)) return "copy";
  return "skip";
}
function codexLinkAction(place, source, platform = process.platform) {
  if (place.kind === "missing") return "create";
  if (place.kind === "link" && sameFolderPath(place.target, source, platform)) return "linked";
  return "conflict";
}
function sameFolderPath(a, b, platform) {
  if (platform !== "win32") return import_node_path9.posix.resolve(a) === import_node_path9.posix.resolve(b);
  return import_node_path9.win32.resolve(a).toLowerCase() === import_node_path9.win32.resolve(b).toLowerCase();
}
function codexStaleLink(link, source, shared, platform = process.platform) {
  const paths = platform === "win32" ? import_node_path9.win32 : import_node_path9.posix;
  const recorded = link.recorded !== null && sameFolderPath(link.target, link.recorded, platform);
  if (sameFolderPath(link.target, paths.join(source, link.name), platform)) return !shared && (link.end !== "other" || recorded);
  return link.end === "nothing" && recorded;
}
function codexAgentsCopy(source, current, copiedBefore) {
  if (source !== null) return current === source ? null : { action: "write", content: source };
  return current !== null && copiedBefore ? { action: "remove" } : null;
}
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}
function codexConfigRefresh(source, current, lastMerged) {
  const keep = (merged, missingSecrets, heldBack, mergeFailure) => ({ action: "keep", content: null, merged, missingSecrets, heldBack, mergeFailure });
  if (source === null) return keep(lastMerged === null ? "" : null, false, [], null);
  if (current !== null && !validToml(current)) return keep(null, false, [], "the login's config.toml is not valid TOML, so it was left as it is");
  let merge;
  try {
    merge = mergeAccountConfig(source, current ?? "", lastMerged);
  } catch (error) {
    return keep(null, false, [], `the default home's config.toml could not be merged in: ${errorText(error)}`);
  }
  try {
    if (current !== null && sameTomlSettings(current, merge.content)) return keep(merge.merged, merge.missingSecrets, merge.heldBack, null);
  } catch (error) {
    return keep(null, merge.missingSecrets, merge.heldBack, `the merged config.toml could not be compared: ${errorText(error)}`);
  }
  return { action: "write", content: merge.content, merged: merge.merged, missingSecrets: merge.missingSecrets, heldBack: merge.heldBack, mergeFailure: null };
}

// src/platform/links.ts
var import_promises3 = require("node:fs/promises");
var import_node_path10 = require("node:path");
function pathsOf2(platform) {
  return platform === "win32" ? import_node_path10.win32 : import_node_path10.posix;
}
function normaliseLinkTarget(target, platform) {
  if (platform !== "win32") return target;
  const unc = /^(?:\\\\\?\\|\\\?\?\\)UNC\\/i.exec(target);
  if (unc !== null) return `\\\\${target.slice(unc[0].length)}`;
  const long = /^(?:\\\\\?\\|\\\?\?\\)(?=[a-z]:)/i.exec(target);
  if (long !== null) return target.slice(long[0].length);
  return target;
}
function linkTargetPath(place, target, platform) {
  const paths = pathsOf2(platform);
  return paths.resolve(paths.dirname(place), normaliseLinkTarget(target, platform));
}
function errorCode(error) {
  const code = error?.code;
  return typeof code === "string" ? code : void 0;
}
async function readFolderLink(place, platform = process.platform) {
  let stats;
  try {
    stats = await (0, import_promises3.lstat)(place);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { kind: "missing" };
    throw error;
  }
  if (!stats.isSymbolicLink()) return { kind: "other" };
  return { kind: "link", target: linkTargetPath(place, await (0, import_promises3.readlink)(place), platform) };
}
async function linkFolder(target, place, platform = process.platform) {
  const absolute = pathsOf2(platform).resolve(target);
  if (platform !== "win32") {
    await (0, import_promises3.symlink)(absolute, place, "dir");
    return;
  }
  try {
    await (0, import_promises3.symlink)(absolute, place, "junction");
  } catch (error) {
    if (errorCode(error) === "EEXIST") throw error;
    try {
      await (0, import_promises3.symlink)(absolute, place, "dir");
    } catch {
      throw error;
    }
  }
}
async function removeFolderLink(place, platform = process.platform) {
  if (!(await (0, import_promises3.lstat)(place)).isSymbolicLink()) throw new Error(`${place} is not a link`);
  if (platform !== "win32") {
    await (0, import_promises3.unlink)(place);
    return;
  }
  try {
    await (0, import_promises3.unlink)(place);
  } catch (error) {
    const code = errorCode(error);
    if (code !== "EPERM" && code !== "EISDIR" && code !== "EACCES") throw error;
    await (0, import_promises3.rmdir)(place);
  }
}

// src/cli/codex-home-files.ts
function emptyRecord(config) {
  return { config, copied: {}, links: {}, conflicts: [] };
}
async function prepareCodexHome(login, options) {
  const name = login.alias ?? login.id;
  if (login.provider !== "codex") throw new Error(`${name} is not a Codex login.`);
  if (login.machineOwn) return { codexHome: null, warnings: [] };
  const platform = options.platform ?? process.platform;
  const home = loginFolder(login);
  try {
    makePrivateDirSync(home);
  } catch (error) {
    throw new Error(`Could not create the Codex home of ${name} at ${home}: ${errorText2(error)}`, { cause: error });
  }
  const source = codexSourceHome(options.env, platform);
  const warnings = [];
  const recordPath = codexMergedRecordPath(login);
  const isNew = await isEmptyFolder(home);
  const record2 = isNew ? emptyRecord("") : await readRecord(recordPath, warnings);
  const next = { config: record2.config, copied: { ...record2.copied }, links: {}, conflicts: [] };
  await linkSharedFolders(source, home, platform, warnings, record2, next);
  for (const file of CODEX_AGENTS_FILES) await copyAgents(source, home, file, warnings, record2, next);
  await refreshConfig(source, home, warnings, record2, next);
  next.conflicts.sort();
  if (isNew || formatJson(next) !== formatJson(record2)) {
    try {
      await writeJsonFile(recordPath, next, { mode: PRIVATE_FILE_MODE });
    } catch (error) {
      warnings.push(`Could not save what was merged into ${home} to ${recordPath}: ${errorText2(error)}`);
    }
  }
  return { codexHome: home, warnings };
}
async function isEmptyFolder(folder) {
  try {
    return (await (0, import_promises4.readdir)(folder)).length === 0;
  } catch {
    return false;
  }
}
async function readRecord(path, warnings) {
  let read;
  try {
    read = await readJsonFile(path);
  } catch (error) {
    warnings.push(`Could not read ${path}, so this start keeps every setting of the login's config.toml: ${errorText2(error)}`);
    return emptyRecord("");
  }
  if (read.status === "missing") return emptyRecord(null);
  if (read.status !== "ok" || read.value === null || typeof read.value !== "object" || Array.isArray(read.value)) {
    warnings.push(`${path} is damaged, so this start keeps every setting of the login's config.toml.`);
    return emptyRecord("");
  }
  const value = read.value;
  const conflicts = value["conflicts"];
  const config = value["config"];
  return {
    config: typeof config === "string" ? config : config === null ? null : "",
    copied: stringRecord(value["copied"]),
    links: stringRecord(value["links"]),
    conflicts: Array.isArray(conflicts) ? conflicts.filter((name) => typeof name === "string") : []
  };
}
function stringRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry) => typeof entry[1] === "string"));
}
function sha256(text2) {
  return (0, import_node_crypto6.createHash)("sha256").update(text2).digest("hex");
}
function codexSourceHome(env, platform = process.platform) {
  const fallback = (0, import_node_path11.join)((0, import_node_os4.homedir)(), ".codex");
  const named = env.CODEX_HOME;
  if (named === void 0 || named === "") return fallback;
  const home = (0, import_node_path11.resolve)(named);
  return insideFolder(providerFolder("codex"), home, platform) ? fallback : home;
}
function insideFolder(folder, path, platform) {
  const paths = pathsOf2(platform);
  const fold = (text2) => platform === "win32" ? text2.toLowerCase() : text2;
  const relative2 = paths.relative(fold(paths.resolve(folder)), fold(paths.resolve(path)));
  return relative2 === "" || !relative2.startsWith("..") && !paths.isAbsolute(relative2);
}
function errorText2(error) {
  return error instanceof Error ? error.message : String(error);
}
function errorCode2(error) {
  const code = error?.code;
  return typeof code === "string" ? code : void 0;
}
async function entryKind(source, entry) {
  if (entry.isSymbolicLink()) {
    try {
      return (await (0, import_promises4.stat)((0, import_node_path11.join)(source, entry.name))).isDirectory() ? "directory-link" : "symlink";
    } catch {
      return "symlink";
    }
  }
  if (entry.isDirectory()) return "directory";
  if (entry.isFile()) return "file";
  return "other";
}
async function sharedFolders(source, home, warnings) {
  let entries;
  try {
    entries = await (0, import_promises4.readdir)(source, { withFileTypes: true });
  } catch (error) {
    if (errorCode2(error) === "ENOENT") return [];
    warnings.push(`Could not list ${source} to link its folders into ${home}: ${errorText2(error)}`);
    return null;
  }
  const shared = [];
  for (const entry of entries) {
    if (codexHomeEntryAction(entry.name, await entryKind(source, entry)) === "link") shared.push(entry.name);
  }
  return shared;
}
async function linkSharedFolders(source, home, platform, warnings, record2, next) {
  const shared = await sharedFolders(source, home, warnings);
  if (shared === null) {
    next.conflicts = [...record2.conflicts];
    next.links = { ...record2.links };
    return;
  }
  await removeStaleLinks(source, home, new Set(shared), platform, warnings, record2, next);
  for (const name of shared) {
    const from = (0, import_node_path11.join)(source, name);
    const place = (0, import_node_path11.join)(home, name);
    try {
      if (await placeLink(from, place, platform) === "linked") {
        next.links[name] = from;
        continue;
      }
      next.conflicts.push(name);
      if (!record2.conflicts.includes(name)) {
        warnings.push(`${place} is a folder of this login's own with something in it, or a link to somewhere else, so it was left as it is and not linked to ${from}. Move it away to share ${from} with this login. This is said once.`);
      }
    } catch (error) {
      warnings.push(`Could not link ${place} to ${from}: ${errorText2(error)}`);
    }
  }
}
async function linkEnd(place) {
  try {
    return (await (0, import_promises4.stat)(place)).isDirectory() ? "folder" : "other";
  } catch (error) {
    const code = errorCode2(error);
    return code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP" ? "nothing" : "other";
  }
}
async function removeStaleLinks(source, home, shared, platform, warnings, record2, next) {
  let entries;
  try {
    entries = await (0, import_promises4.readdir)(home, { withFileTypes: true });
  } catch (error) {
    warnings.push(`Could not list ${home} to remove the links that lead nowhere: ${errorText2(error)}`);
    return;
  }
  for (const entry of entries) {
    if (entry.isFile()) continue;
    const place = (0, import_node_path11.join)(home, entry.name);
    try {
      const found = await readFolderLink(place, platform);
      if (found.kind !== "link") continue;
      const recorded = Object.hasOwn(record2.links, entry.name) ? record2.links[entry.name] : null;
      const link = { name: entry.name, target: found.target, end: await linkEnd(place), recorded };
      if (!codexStaleLink(link, source, shared.has(entry.name), platform)) {
        if (recorded !== null) next.links[entry.name] = recorded;
        continue;
      }
      try {
        await removeFolderLink(place, platform);
      } catch (error) {
        if (errorCode2(error) !== "ENOENT") throw error;
      }
    } catch (error) {
      warnings.push(`Could not remove ${place}, a link that leads nowhere or to a folder this login no longer shares: ${errorText2(error)}`);
    }
  }
}
var LINK_ATTEMPTS = 4;
var LINK_RETRY_DELAY_MS = 25;
function retryableLinkError(code, platform) {
  if (code === "EEXIST" || code === "ENOENT") return true;
  return platform === "win32" && (code === "EBUSY" || code === "EPERM" || code === "EACCES");
}
async function placeLink(from, place, platform, link = linkFolder) {
  let failure2 = null;
  for (let attempt = 1; attempt <= LINK_ATTEMPTS; attempt++) {
    if (attempt > 1) await (0, import_promises5.setTimeout)(LINK_RETRY_DELAY_MS);
    const found = await readFolderLink(place, platform);
    const action = codexLinkAction(found, from, platform);
    if (action === "linked") return "linked";
    if (action === "conflict") {
      if (found.kind !== "other") return "conflict";
      const removed = await removeEmptyFolder(place, platform);
      if (removed === "kept") return "conflict";
      if (removed === "again") continue;
    }
    try {
      await link(from, place, platform);
      return "linked";
    } catch (error) {
      if (!retryableLinkError(errorCode2(error), platform)) throw error;
      failure2 = error;
    }
  }
  if (codexLinkAction(await readFolderLink(place, platform), from, platform) === "linked") return "linked";
  if (failure2 !== null && errorCode2(failure2) !== "EEXIST") throw failure2;
  return "conflict";
}
async function removeEmptyFolder(place, platform) {
  try {
    const stats = await (0, import_promises4.lstat)(place);
    if (stats.isSymbolicLink()) return "again";
    if (!stats.isDirectory()) return "kept";
    await (0, import_promises4.rmdir)(place);
    return "removed";
  } catch (error) {
    const code = errorCode2(error);
    return code === "ENOTDIR" || code !== "EEXIST" && retryableLinkError(code, platform) ? "again" : "kept";
  }
}
async function copyAgents(source, home, file, warnings, record2, next) {
  const from = (0, import_node_path11.join)(source, file);
  const target = (0, import_node_path11.join)(home, file);
  try {
    const text2 = await readText(from);
    const said = { decision: null };
    const outcome = await writeIfUnchanged(target, (current) => {
      said.decision = codexAgentsCopy(text2, current, current !== null && record2.copied[file] === sha256(current));
      return said.decision?.action === "write" ? said.decision.content : null;
    }, 420);
    if (outcome === "changing") {
      warnings.push(changingWarning(target));
      return;
    }
    if (said.decision?.action === "remove") {
      const current = await readText(target);
      if (current !== null && record2.copied[file] === sha256(current)) await (0, import_promises4.rm)(target, { force: true });
    }
    if (text2 === null) delete next.copied[file];
    else next.copied[file] = sha256(text2);
  } catch (error) {
    warnings.push(`Could not copy ${from} to ${target}: ${errorText2(error)}`);
  }
}
async function refreshConfig(source, home, warnings, record2, next) {
  const from = (0, import_node_path11.join)(source, CODEX_CONFIG_FILE);
  const target = (0, import_node_path11.join)(home, CODEX_CONFIG_FILE);
  try {
    const text2 = await readText(from);
    const said = { missingSecrets: false, heldBack: [], mergeFailure: null, merged: null };
    const outcome = await writeIfUnchanged(target, (current) => {
      const refresh = codexConfigRefresh(text2, current, record2.config);
      said.missingSecrets = refresh.missingSecrets;
      said.heldBack = refresh.heldBack;
      said.mergeFailure = refresh.mergeFailure;
      said.merged = refresh.merged;
      return refresh.action === "write" ? refresh.content : null;
    }, PRIVATE_FILE_MODE);
    if (said.mergeFailure !== null) warnings.push(`Could not refresh ${target} from ${from}: ${said.mergeFailure}.`);
    if (said.missingSecrets) {
      warnings.push(`${from} has a secret, such as an MCP server's env table, that ${target} lacks. It is never copied; add it to ${target} if this login needs it.`);
    }
    if (said.heldBack.length > 0) {
      warnings.push(`${from} sets ${said.heldBack.join(", ")} differently from ${target}, and a secret stands in the way, so ${target} keeps its own. Secrets are never copied; change ${target} by hand if this login needs the default home's.`);
    }
    if (outcome === "changing") warnings.push(changingWarning(target));
    else if (said.merged !== null) next.config = said.merged;
  } catch (error) {
    warnings.push(`Could not refresh ${target} from ${from}: ${errorText2(error)}`);
  }
}
function changingWarning(target) {
  return `${target} kept changing while kurmis refreshed it, so it was left as it is. The next start refreshes it again.`;
}
async function readText(path) {
  try {
    return await (0, import_promises4.readFile)(path, "utf8");
  } catch (error) {
    if (errorCode2(error) === "ENOENT") return null;
    throw error;
  }
}
var TEMP_FLAGS2 = import_node_fs9.constants.O_WRONLY | import_node_fs9.constants.O_CREAT | import_node_fs9.constants.O_EXCL;
async function writeIfUnchanged(target, next, mode) {
  for (let attempt = 1; attempt <= CODEX_CONFIG_MERGE_ATTEMPTS; attempt++) {
    const current = await readText(target);
    const text2 = next(current);
    if (text2 === null) return "unchanged";
    const temp = `${target}.${String(process.pid)}.${(0, import_node_crypto6.randomBytes)(4).toString("hex")}.tmp`;
    const handle = await (0, import_promises4.open)(temp, TEMP_FLAGS2, mode);
    try {
      try {
        await handle.writeFile(text2);
        await handle.sync();
      } finally {
        await handle.close();
      }
      if (await readText(target) !== current) {
        await (0, import_promises4.rm)(temp, { force: true });
        continue;
      }
      await replaceFile(temp, target);
    } catch (error) {
      await (0, import_promises4.rm)(temp, { force: true });
      throw error;
    }
    await syncDirectory((0, import_node_path11.dirname)(target));
    return "written";
  }
  return "changing";
}

// src/cli/daemon-client.ts
var import_node_os5 = require("node:os");
var import_node_path13 = require("node:path");

// src/core/proxy-rules.ts
var ROUTE_PATHS = [
  { method: "POST", path: "/v1/messages" },
  { method: "POST", path: "/v1/messages/count_tokens" },
  { method: "GET", path: "/v1/models" }
];
var HELLO_PATH = "/api/hello";
var CONTROL_PREFIX = "/_kurmis/";
function requestKind(method, url) {
  const path = (url ?? "").split("?")[0] ?? "";
  if (path === HELLO_PATH && (method === "HEAD" || method === "GET")) return { kind: "hello" };
  if (path.startsWith(CONTROL_PREFIX)) return { kind: "control", path };
  if (ROUTE_PATHS.some((entry) => entry.method === method && entry.path === path)) return { kind: "route", path };
  return { kind: "unknown" };
}
var ROUTER_REFUSAL_STATUS = 599;
var HOP_HEADERS = /* @__PURE__ */ new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);
var REPLACED_REQUEST_HEADERS = /* @__PURE__ */ new Set([
  "authorization",
  "x-api-key",
  "host",
  "content-length",
  "accept-encoding"
]);
function droppedHeaders(connection) {
  return /* @__PURE__ */ new Set([...HOP_HEADERS, ...(connection ?? "").toLowerCase().split(",").map((name) => name.trim())]);
}
function upstreamRequest(incoming, body, authorization, accountUuid) {
  const connection = incoming["connection"];
  const drop = droppedHeaders(Array.isArray(connection) ? connection.join(",") : connection);
  const headers = {};
  for (const [rawName, value] of Object.entries(incoming)) {
    const name = rawName.toLowerCase();
    if (value === void 0 || drop.has(name) || REPLACED_REQUEST_HEADERS.has(name) || KURMIS_HEADERS.includes(name)) continue;
    headers[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  headers["authorization"] = authorization;
  headers["accept-encoding"] = "identity";
  const outgoing = body === void 0 ? void 0 : outgoingBody(body, accountUuid);
  if (outgoing !== void 0) headers["content-length"] = String(outgoing.length);
  return { headers, body: outgoing };
}
function downstreamResponseHeaders(upstream) {
  const entries = [...upstream].map(([name, value]) => [name.toLowerCase(), value]);
  const drop = droppedHeaders(entries.find(([name]) => name === "connection")?.[1]);
  return entries.filter(([name]) => !drop.has(name) && name !== "content-length");
}
function rewriteUserId(userId, accountUuid) {
  let value;
  try {
    value = JSON.parse(userId);
  } catch {
    return userId;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return userId;
  if (value["account_uuid"] === accountUuid) return userId;
  const bytes = Buffer.from(userId, "utf8");
  const open4 = skipWhitespace(bytes, 0);
  const found = memberValue(bytes, open4, "account_uuid");
  const uuid = Buffer.from(JSON.stringify(accountUuid), "utf8");
  if (found.span !== null) return splice(bytes, found.span.start, found.span.end, uuid).toString("utf8");
  const close = skipValue(bytes, open4) - 1;
  const member = Buffer.concat([Buffer.from(`${found.members > 0 ? "," : ""}"account_uuid":`, "utf8"), uuid]);
  return splice(bytes, close, close, member).toString("utf8");
}
function outgoingBody(body, accountUuid) {
  if (accountUuid === null) return body;
  const open4 = skipWhitespace(body, 0);
  if (body[open4] !== BRACE_OPEN) return body;
  const metadata = memberValue(body, open4, "metadata").span;
  if (metadata === null || body[metadata.start] !== BRACE_OPEN) return body;
  const userId = memberValue(body, metadata.start, "user_id").span;
  if (userId === null || body[userId.start] !== QUOTE) return body;
  const current = JSON.parse(body.subarray(userId.start, userId.end).toString("utf8"));
  const rewritten = rewriteUserId(current, accountUuid);
  if (rewritten === current) return body;
  return splice(body, userId.start, userId.end, Buffer.from(JSON.stringify(rewritten), "utf8"));
}
var QUOTE = 34;
var BACKSLASH = 92;
var BRACE_OPEN = 123;
var BRACE_CLOSE = 125;
var BRACKET_OPEN = 91;
var BRACKET_CLOSE = 93;
var COMMA = 44;
var COLON = 58;
function isWhitespace(byte) {
  return byte === 32 || byte === 9 || byte === 10 || byte === 13;
}
function skipWhitespace(bytes, index) {
  let at2 = index;
  while (at2 < bytes.length && isWhitespace(bytes[at2])) at2++;
  return at2;
}
function skipString(bytes, index) {
  let at2 = index + 1;
  while (at2 < bytes.length) {
    const byte = bytes[at2];
    if (byte === BACKSLASH) at2 += 2;
    else if (byte === QUOTE) return at2 + 1;
    else at2++;
  }
  return at2;
}
function skipValue(bytes, index) {
  const first = bytes[index];
  if (first === QUOTE) return skipString(bytes, index);
  if (first === BRACE_OPEN || first === BRACKET_OPEN) {
    let depth = 0;
    let at3 = index;
    while (at3 < bytes.length) {
      const byte = bytes[at3];
      if (byte === QUOTE) {
        at3 = skipString(bytes, at3);
        continue;
      }
      if (byte === BRACE_OPEN || byte === BRACKET_OPEN) depth++;
      else if (byte === BRACE_CLOSE || byte === BRACKET_CLOSE) {
        depth--;
        if (depth === 0) return at3 + 1;
      }
      at3++;
    }
    return at3;
  }
  let at2 = index;
  while (at2 < bytes.length) {
    const byte = bytes[at2];
    if (byte === COMMA || byte === BRACE_CLOSE || byte === BRACKET_CLOSE || isWhitespace(byte)) break;
    at2++;
  }
  return at2;
}
function memberValue(bytes, open4, name) {
  let span = null;
  let members = 0;
  let at2 = skipWhitespace(bytes, open4 + 1);
  while (at2 < bytes.length && bytes[at2] === QUOTE) {
    const keyEnd = skipString(bytes, at2);
    const key = JSON.parse(bytes.subarray(at2, keyEnd).toString("utf8"));
    at2 = skipWhitespace(bytes, keyEnd);
    if (bytes[at2] !== COLON) break;
    const start2 = skipWhitespace(bytes, at2 + 1);
    const end = skipValue(bytes, start2);
    members++;
    if (key === name) span = { start: start2, end };
    at2 = skipWhitespace(bytes, end);
    if (bytes[at2] !== COMMA) break;
    at2 = skipWhitespace(bytes, at2 + 1);
  }
  return { span, members };
}
function splice(bytes, start2, end, insert) {
  return Buffer.concat([bytes.subarray(0, start2), insert, bytes.subarray(end)]);
}
function staleUsageLogins(session, rows, now, refreshed) {
  const pinned = effectivePin(session, rows);
  return rows.filter((row) => {
    const reset = busiestPlanWindow(row.usage)?.resetsAt;
    return !refreshed.has(row.id) && row.loggedIn && row.credentialsReadable && (pinned === null ? row.autoRoute : row.id === pinned) && reset != null && Date.parse(reset) <= now;
  }).map((row) => row.id);
}
function withoutExpiringTokens(rows, now, session) {
  const pinned = effectivePin(session, rows);
  return rows.map((row) => row.tokenExpiresAt !== null && !tokenIsFresh(row.tokenExpiresAt, now) && (pinned === null || poolReadyAt([row], now, pinned, session.homeAccountId) === now) ? { ...row, credentialsReadable: false } : row);
}
function refusalAnswer(session, rows, now, cliOnOwnCredentials = false) {
  const usable = withoutExpiringTokens(rows, now, session);
  if (accountsInScope(session, usable).length === 0) return { ...noSignerAnswer(cliOnOwnCredentials), kind: "no-signer", resetAt: null };
  return { ...poolLimitAnswer(session, usable, now), kind: "pool-limit" };
}
function noSignerAnswer(cliOnOwnCredentials = false) {
  const message = cliOnOwnCredentials ? "No Claude login kurmis may use for this session could sign the request. This Claude CLI runs with CLAUDE_CONFIG_DIR set, so it is signed in with the login in that folder, which is not the login a plain `claude` uses, and kurmis signs its requests only with its extra logins. Add one with `kurmis login claude`, start Claude with `kurmis claude`, or run `kurmis setup --pause` with that CLAUDE_CONFIG_DIR." : "No Claude login kurmis may use for this session could sign the request. Run `kurmis status` to see which logins are signed in.";
  return {
    status: ROUTER_REFUSAL_STATUS,
    headers: { "content-type": "application/json", "retry-after": "5" },
    body: JSON.stringify({ type: "error", error: { type: "api_error", message } })
  };
}
function poolLimitAnswer(session, all, now) {
  const pinned = effectivePin(session, all);
  const rows = all.filter((row) => pinned === null || row.id === pinned);
  const reset = poolReadyAt(rows, now, pinned, session.homeAccountId);
  const next = reset === null ? void 0 : rows.find((row) => poolReadyAt([row], now, pinned, session.homeAccountId) === reset);
  const blocking = next === void 0 ? void 0 : planUsageWindows(usageAsOf(next.usage, now)).filter((window) => window.utilization >= (pinned === null ? limitForWindow(next, window) : 100)).sort((a, b) => Date.parse(b.resetsAt ?? "") - Date.parse(a.resetsAt ?? ""))[0];
  const claim = blocking?.key ?? next?.usage?.limited?.window ?? "five_hour";
  const message = `Usage limit reached for every login kurmis may use.${reset === null ? "" : ` Resets at ${new Date(reset).toISOString()}.`}`;
  return {
    status: 429,
    headers: {
      "content-type": "application/json",
      "anthropic-ratelimit-unified-status": "rejected",
      "anthropic-ratelimit-unified-representative-claim": claim,
      ...reset === null ? {} : { "anthropic-ratelimit-unified-reset": String(reset / 1e3) },
      "retry-after": String(reset === null ? 1 : Math.max(1, Math.ceil((reset - now) / 1e3)))
    },
    body: JSON.stringify({ type: "error", error: { type: "rate_limit_error", message } }),
    resetAt: reset
  };
}
function cooldownAfterProbe(cooldownUntil, snapshot) {
  if (cooldownUntil !== Infinity || snapshot.source !== "probe" || snapshot.error !== null || !snapshot.rateLimitsAvailable) {
    return cooldownUntil;
  }
  const reset = resetsAtFromUsage(snapshot);
  if (reset !== null && Number.isFinite(Date.parse(reset))) return Date.parse(reset);
  return snapshot.status === "rejected" ? cooldownUntil : null;
}
function routeBlockText(block, keychain = false, startedOn = false, platform = process.platform) {
  switch (block.kind) {
    case "auto-route-off":
      return "not opted in to routing";
    case "signed-out":
      return "signed out";
    case "no-credentials":
      if (!keychain) {
        return platform === "win32" ? "no token, neither Windows Credential Manager nor its .credentials.json gave one" : "no token, its .credentials.json did not read";
      }
      return startedOn ? "no token, its Keychain item did not read and the request carried no authorization header of its own" : "no token, its Keychain item did not read and the CLI signs only for the login it was started on";
    case "token-expiring":
      return "its token expires within 5 minutes";
    case "cooldown":
      return block.until === null ? "cooling down until a usage probe says it is back" : `cooling down until ${new Date(block.until).toISOString()}`;
    case "over-limit":
      return `at its limit, the ${block.window} window is at ${String(Math.round(block.utilization))}% of ${String(block.limitPercent)}%`;
  }
}

// src/core/control-api.ts
var CONTROL_API_VERSION = 2;
var CONTROL_PATHS = {
  /** `GET`: `StatusAnswer`. */
  status: `${CONTROL_PREFIX}status`,
  /** `POST` with a `ProbeRequest`: probes the logins now and answers `StatusAnswer` when done. */
  probe: `${CONTROL_PREFIX}probe`,
  /** `POST`: reads `config.json` again. Answers `OkAnswer`. */
  reload: `${CONTROL_PREFIX}reload`,
  /**
   * `POST` with an optional `StopRequest` (no body is the same as `{}`): answers `OkAnswer`,
   * then stops taking new requests and exits once the open ones have finished.
   */
  stop: `${CONTROL_PREFIX}stop`
};
var MAX_CONTROL_BODY_BYTES = 64 * 1024;

// src/data/daemon-file.ts
var import_node_crypto7 = require("node:crypto");
var import_node_fs10 = require("node:fs");
var import_node_path12 = require("node:path");
function generateDaemonSecret() {
  return (0, import_node_crypto7.randomBytes)(32).toString("hex");
}
var SECRET_PATTERN = /^[0-9a-f]{64}$/;
function readKey(path = keyPath()) {
  let text2;
  try {
    text2 = (0, import_node_fs10.readFileSync)(path, "utf8").trim();
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  return SECRET_PATTERN.test(text2) ? text2 : null;
}
function readOrCreateKey(path = keyPath()) {
  const existing = readKey(path);
  if (existing !== null) return existing;
  makePrivateDirSync((0, import_node_path12.dirname)(path));
  const key = generateDaemonSecret();
  if (!createKeyFile(path, key)) {
    const theirs = readKeySettled(path);
    if (theirs !== null) return theirs;
    writeFileAtomicSync(path, `${key}
`, { mode: PRIVATE_FILE_MODE });
  }
  return key;
}
function createKeyFile(path, key) {
  const temporary = (0, import_node_path12.join)((0, import_node_path12.dirname)(path), `.key-${process.pid}-${(0, import_node_crypto7.randomBytes)(4).toString("hex")}`);
  writeFileAtomicSync(temporary, `${key}
`, { mode: PRIVATE_FILE_MODE });
  try {
    (0, import_node_fs10.linkSync)(temporary, path);
    return true;
  } catch (error) {
    if (error.code === "EEXIST") return false;
  } finally {
    (0, import_node_fs10.rmSync)(temporary, { force: true });
  }
  try {
    (0, import_node_fs10.writeFileSync)(path, `${key}
`, { flag: "wx", mode: PRIVATE_FILE_MODE });
    return true;
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  }
}
function readKeySettled(path) {
  for (let attempt = 0; ; attempt++) {
    const key = readKey(path);
    if (key !== null || attempt >= 10) return key;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
}
function isPositiveInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
function parseDaemonInfo(value) {
  if (!isPlainObject(value)) return "is not an object";
  if (!isPositiveInteger(value.pid)) return "pid must be a positive whole number";
  if (!isPositiveInteger(value.port) || value.port > 65535) return "port must be a whole number from 1 to 65535";
  if (typeof value.version !== "string" || value.version === "") return "version must be a string";
  if (typeof value.startedAt !== "number" || !Number.isFinite(value.startedAt)) return "startedAt must be a number";
  return { pid: value.pid, port: value.port, version: value.version, startedAt: value.startedAt };
}
function readDaemonFile(path = daemonFilePath()) {
  let read;
  try {
    read = readJsonFileSync(path);
  } catch (error) {
    return { status: "invalid", reason: `${path} could not be read (${String(error.code)})` };
  }
  if (read.status === "missing") return { status: "missing" };
  if (read.status === "corrupt") return { status: "invalid", reason: `${path} is not valid JSON` };
  const info = parseDaemonInfo(read.value);
  return typeof info === "string" ? { status: "invalid", reason: `${path}: ${info}` } : { status: "ok", info };
}
function writeDaemonFile(info, path = daemonFilePath()) {
  writeJsonFileSync(path, info, { mode: PRIVATE_FILE_MODE });
}
function removeDaemonFile(pid, path = daemonFilePath(), afterCheck) {
  const read = readDaemonFile(path);
  if (read.status === "missing") return false;
  if (read.status === "ok" && read.info.pid !== pid) return false;
  afterCheck?.();
  const aside = `${path}.${String(process.pid)}-${(0, import_node_crypto7.randomBytes)(4).toString("hex")}.removing`;
  try {
    retryWhileLockedSync(() => {
      (0, import_node_fs10.renameSync)(path, aside);
    });
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  let keepAside = false;
  try {
    const moved = readDaemonFile(aside);
    if (moved.status === "ok" && moved.info.pid !== pid) {
      try {
        (0, import_node_fs10.linkSync)(aside, path);
      } catch (error) {
        if (error.code !== "EEXIST" && !(0, import_node_fs10.existsSync)(path)) {
          try {
            retryWhileLockedSync(() => {
              (0, import_node_fs10.renameSync)(aside, path);
            });
          } catch {
            keepAside = true;
          }
        }
      }
      return false;
    }
    return true;
  } finally {
    if (!keepAside) (0, import_node_fs10.rmSync)(aside, { force: true });
  }
}

// src/daemon/lifecycle.ts
var import_node_http = require("node:http");
var import_node_net = require("node:net");
var DAEMON_HOST = "127.0.0.1";
var CONTROL_TIMEOUT_MS = 5e3;
var MAX_ANSWER_BYTES = 4 * 1024 * 1024;
function controlRequest(options) {
  const timeoutMs = options.timeoutMs ?? CONTROL_TIMEOUT_MS;
  const payload = options.body === void 0 ? void 0 : JSON.stringify(options.body);
  return new Promise((resolve8) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve8(result);
    };
    const headers = { [KEY_HEADER]: options.key, connection: "close" };
    if (payload !== void 0) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(payload));
    }
    const outgoing = (0, import_node_http.request)(
      {
        host: DAEMON_HOST,
        port: options.port,
        method: options.method,
        path: options.path,
        headers,
        agent: false,
        signal: options.signal
      },
      (incoming) => {
        const chunks = [];
        let size = 0;
        incoming.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_ANSWER_BYTES) {
            finish({ kind: "failed", reason: "the answer was too large" });
            outgoing.destroy();
            return;
          }
          chunks.push(chunk);
        });
        incoming.on("error", (error) => finish({ kind: "failed", reason: error.message }));
        incoming.on("end", () => {
          const text2 = Buffer.concat(chunks).toString("utf8");
          let body;
          try {
            body = text2 === "" ? null : JSON.parse(text2);
          } catch {
            body = null;
          }
          finish({ kind: "answered", status: incoming.statusCode ?? 0, body });
        });
      }
    );
    const timer = setTimeout(() => {
      finish({ kind: "failed", reason: `no answer within ${String(timeoutMs)} ms` });
      outgoing.destroy();
    }, timeoutMs);
    outgoing.on("error", (error) => {
      finish(error.code === "ECONNREFUSED" ? { kind: "refused" } : { kind: "failed", reason: error.code ?? error.message });
    });
    outgoing.end(payload);
  });
}
function isStatusAnswer(value) {
  return isPlainObject(value) && value.ok === true && typeof value.version === "string" && typeof value.pid === "number" && typeof value.port === "number" && typeof value.startedAt === "number" && Array.isArray(value.logins);
}
async function portHolder(port, key, timeoutMs = CONTROL_TIMEOUT_MS) {
  const result = await controlRequest({ port, key, method: "GET", path: CONTROL_PATHS.status, timeoutMs });
  if (result.kind === "refused") return { kind: "free" };
  if (result.kind === "failed") return { kind: "other", reason: result.reason };
  if (result.status === 200 && isStatusAnswer(result.body)) return { kind: "kurmis", status: result.body };
  return { kind: "other", reason: `it answered ${String(result.status)} to a kurmis status request`, status: result.status };
}
function portAcceptsConnections(port, timeoutMs = 1e3) {
  return new Promise((resolve8) => {
    const socket = (0, import_node_net.createConnection)({ host: DAEMON_HOST, port });
    const done = (accepted) => {
      clearTimeout(timer);
      socket.destroy();
      resolve8(accepted);
    };
    const timer = setTimeout(() => done(true), timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("error", (error) => done(error.code !== "ECONNREFUSED"));
  });
}
function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (left === null || right === null) return null;
  const length = Math.max(left.parts.length, right.parts.length);
  for (let index = 0; index < length; index++) {
    const x = left.parts[index] ?? 0;
    const y = right.parts[index] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  if (left.pre === right.pre) return 0;
  if (left.pre === null) return 1;
  if (right.pre === null) return -1;
  return left.pre < right.pre ? -1 : 1;
}
function parseVersion(text2) {
  const match = /^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(text2.trim());
  if (match === null) return null;
  return { parts: (match[1] ?? "").split(".").map(Number), pre: match[2] ?? null };
}
function shouldReplace(daemonVersion, cliVersion) {
  return compareVersions(daemonVersion, cliVersion) === -1;
}
function delay2(ms) {
  return new Promise((resolve8) => {
    setTimeout(resolve8, ms);
  });
}
function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

// src/platform/system-programs.ts
var SYSTEM_PROGRAM_VARIABLES = {
  launchctl: "KURMIS_LAUNCHCTL_PROGRAM",
  security: "KURMIS_SECURITY_PROGRAM",
  powershell: "KURMIS_POWERSHELL_PROGRAM",
  reg: "KURMIS_REG_PROGRAM",
  taskkill: "KURMIS_TASKKILL_PROGRAM",
  wscript: "KURMIS_WSCRIPT_PROGRAM"
};
function lookup(env, name) {
  const exact = env[name];
  if (exact !== void 0 && exact !== "") return exact;
  const upper = name.toUpperCase();
  for (const [key, value] of Object.entries(env)) {
    if (key.toUpperCase() === upper && value !== void 0 && value !== "") return value;
  }
  return void 0;
}
function systemRoot(env = process.env) {
  const value = lookup(env, "SystemRoot") ?? lookup(env, "windir");
  return value === void 0 ? "C:\\Windows" : value.replace(/[\\/]+$/, "");
}
function realSystemProgram(program, env = process.env) {
  switch (program) {
    case "launchctl":
      return "/bin/launchctl";
    case "security":
      return "/usr/bin/security";
    case "powershell":
      return `${systemRoot(env)}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
    case "reg":
      return `${systemRoot(env)}\\System32\\reg.exe`;
    case "taskkill":
      return `${systemRoot(env)}\\System32\\taskkill.exe`;
    case "wscript":
      return `${systemRoot(env)}\\System32\\wscript.exe`;
  }
}
function systemProgram(program, env = process.env, processEnv = process.env) {
  const variable = SYSTEM_PROGRAM_VARIABLES[program];
  return lookup(env, variable) ?? lookup(processEnv, variable) ?? realSystemProgram(program, env);
}
function inheritedTestHooks(env, processEnv = process.env) {
  const out = {};
  const guarded = lookup(env, GUARD_VARIABLE) === "1" || lookup(processEnv, GUARD_VARIABLE) === "1";
  const names = [...Object.values(SYSTEM_PROGRAM_VARIABLES), GUARD_VARIABLE, REFUSAL_LOG_VARIABLE, ...guarded ? TEST_HOME_VARIABLES : []];
  for (const name of names) {
    if (lookup(env, name) !== void 0) continue;
    const value = lookup(processEnv, name);
    if (value !== void 0) out[name] = value;
  }
  return out;
}

// src/cli/daemon-client.ts
var DaemonError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "DaemonError";
  }
};
var FIND_TIMEOUT_MS = 1e4;
var START_TIMEOUT_MS = 15e3;
var PROBE_TIMEOUT_MS = 9e4;
var STOP_TIMEOUT_MS = 3e4;
var NOW_STOP_TIMEOUT_MS = 15e3;
var STOP_GRACE_MS = 1e4;
var KILL_WAIT_MS = 5e3;
var PORT_FREE_TIMEOUT_MS = 5e3;
var POLL_MS = 100;
function configuredPort() {
  try {
    return loadConfig().port;
  } catch (error) {
    if (error instanceof ConfigError) throw new DaemonError(error.message);
    throw error;
  }
}
function connectionOf(status2, key) {
  return { port: status2.port, key, pid: status2.pid, version: status2.version };
}
async function findDaemon(options, timeoutMs) {
  void options;
  const until = timeoutMs === void 0 ? null : Date.now() + timeoutMs;
  const requestTimeout = () => until === null ? FIND_TIMEOUT_MS : Math.min(FIND_TIMEOUT_MS, Math.max(1, until - Date.now()));
  const key = readKey();
  if (key === null) return null;
  const read = readDaemonFile();
  let triedPort = null;
  if (read.status === "invalid") {
    removeDaemonFileIfDamaged();
  } else if (read.status === "ok") {
    const { pid, port: port2 } = read.info;
    if (!processExists(pid)) {
      try {
        removeDaemonFile(pid);
      } catch {
      }
    } else {
      triedPort = port2;
      const holder2 = await portHolder(port2, key, requestTimeout());
      if (holder2.kind === "kurmis") return connectionOf(holder2.status, key);
    }
  }
  let port;
  try {
    port = loadConfig().port;
  } catch {
    return null;
  }
  if (port === triedPort) return null;
  const holder = await portHolder(port, key, requestTimeout());
  return holder.kind === "kurmis" ? connectionOf(holder.status, key) : null;
}
function removeDaemonFileIfDamaged() {
  const again = readDaemonFile();
  if (again.status !== "invalid") return;
  try {
    removeDaemonFile(-1);
  } catch {
  }
}
var NOT_FOR_THE_DAEMON = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_CUSTOM_HEADERS",
  "CLAUDE_SECURESTORAGE_CONFIG_DIR"
];
function daemonEnvironment(env, processEnv = process.env) {
  const out = { ...env, ...inheritedTestHooks(env, processEnv) };
  for (const name of NOT_FOR_THE_DAEMON) delete out[name];
  if (out.KURMIS_HOME !== void 0 && out.KURMIS_HOME !== "") out.KURMIS_HOME = (0, import_node_path13.resolve)(out.KURMIS_HOME);
  return out;
}
function portBusyMessage(port, reason) {
  return `Port ${String(port)} on 127.0.0.1 is in use by another program (${reason}), so the kurmis daemon cannot listen there. Set "port" in ${configPath()} to a free port from 1024 to 65535, then run the command again.`;
}
async function startDaemon(options) {
  const version = options.version ?? kurmisVersion;
  const port = configuredPort();
  const found = await findDaemon(options);
  let replaced = null;
  if (found !== null) {
    if (found.port === port && !shouldReplace(found.version, version)) {
      return { connection: found, started: false, replaced: null };
    }
    replaced = found.version;
    if (found.port !== port) {
      const order = compareVersions(found.version, version);
      if (order === 1 || order === null && found.version !== version) {
        throw new DaemonError(`The kurmis daemon ${found.version} runs on port ${String(found.port)}, but ${configPath()} names port ${String(port)}. Its version is ${order === 1 ? "newer than" : "not comparable with"} this kurmis (${version}), so this kurmis does not stop it to move it. Update kurmis, or stop the daemon with "kurmis daemon stop" and run the command again.`);
      }
      const stopped = await controlRequest({ port: found.port, key: found.key, method: "POST", path: CONTROL_PATHS.stop });
      if (stopped.kind === "failed" || stopped.kind === "answered" && stopped.status !== 200) {
        throw new DaemonError(`The kurmis daemon ${found.version} on port ${String(found.port)} (pid ${String(found.pid)}) could not be stopped to move it to port ${String(port)}, which ${configPath()} names: ${stopped.kind === "failed" ? stopped.reason : `it answered HTTP ${String(stopped.status)}`}. Stop it with "kurmis daemon stop" after setting the old port back, or end that process, and run the command again.`);
      }
    }
  }
  const key = readOrCreateKey();
  if (found === null) {
    const refusing = await keyRefusingDaemon(key);
    if (refusing !== null) throw new DaemonError(keyRefusedMessage(refusing, options.platform ?? process.platform));
    const holder = await portHolder(port, key, FIND_TIMEOUT_MS);
    if (holder.kind === "other") {
      const silent = silentDaemon();
      if (silent !== null && silent.port === port && holder.status === void 0) {
        throw new DaemonError(notAnsweringMessage(silent, holder.reason, options.platform ?? process.platform));
      }
      throw new DaemonError(portBusyMessage(port, holder.reason));
    }
    if (holder.kind === "kurmis" && !shouldReplace(holder.status.version, version)) {
      return { connection: connectionOf(holder.status, key), started: false, replaced: null };
    }
  }
  const entry = options.entry ?? kurmisEntry({ env: options.env });
  if (entry === null) {
    throw new DaemonError('This kurmis runs from its source tree, so there is no bundle to start the daemon from. Run "pnpm bundle" and use dist/kurmis.cjs, or set KURMIS_ENTRY to a built bundle.');
  }
  const env = daemonEnvironment(options.env);
  let child2;
  try {
    child2 = await spawnDetached({ command: process.execPath, args: [entry, "daemon", "run"], env, cwd: (0, import_node_os5.homedir)() });
  } catch (error) {
    throw new DaemonError(`The kurmis daemon could not be started: ${error instanceof Error ? error.message : String(error)}`);
  }
  const connection = await waitForDaemon({ port, version, child: child2, timeoutMs: options.startTimeoutMs ?? START_TIMEOUT_MS });
  return { connection, started: true, replaced };
}
async function waitForDaemon(wait) {
  const deadline = Date.now() + wait.timeoutMs;
  let exitCode;
  void wait.child.exited.then((code) => {
    exitCode = code;
  });
  for (; ; ) {
    const found = await findDaemon({ env: {} });
    if (found !== null && found.port === wait.port && compareVersions(found.version, wait.version) !== -1) return found;
    if (exitCode !== void 0 && exitCode !== 0) {
      throw new DaemonError(`The kurmis daemon exited at start (${exitCode === null ? "ended by a signal" : `exit code ${String(exitCode)}`}). Run "kurmis daemon run" to see why, or look in ${logPath()}.`);
    }
    if (Date.now() >= deadline) {
      throw new DaemonError(`The kurmis daemon did not answer on port ${String(wait.port)} within ${String(Math.round(wait.timeoutMs / 1e3))} seconds of starting. Run "kurmis daemon run" to see why, or look in ${logPath()}.`);
    }
    await delay2(POLL_MS);
  }
}
async function ensureDaemon(options) {
  return (await startDaemon(options)).connection;
}
function failureOf(result, connection, what) {
  const port = String(connection.port);
  if (result.kind === "refused") return new DaemonError(`The kurmis daemon is not running (nothing answers on port ${port}).`);
  if (result.kind === "failed") return new DaemonError(`The kurmis daemon on port ${port} did not answer ${what}: ${result.reason}.`);
  if (result.status === 403) {
    return new DaemonError(`The program on port ${port} did not accept the key in ${keyPath()}. If it is a kurmis daemon of another data folder, stop it, or set another "port" in config.json.`);
  }
  const said = isPlainObject(result.body) && typeof result.body.error === "string" ? result.body.error : `HTTP ${String(result.status)}`;
  return new DaemonError(`The kurmis daemon refused ${what}: ${said}`);
}
async function readStatus3(connection) {
  const result = await controlRequest({ port: connection.port, key: connection.key, method: "GET", path: CONTROL_PATHS.status });
  if (result.kind === "answered" && result.status === 200 && isStatusAnswer(result.body)) return result.body;
  throw failureOf(result, connection, "a status request");
}
async function requestProbe(connection, logins, signal) {
  const result = await controlRequest({
    port: connection.port,
    key: connection.key,
    method: "POST",
    path: CONTROL_PATHS.probe,
    body: logins === void 0 ? {} : { logins },
    timeoutMs: PROBE_TIMEOUT_MS,
    ...signal === void 0 ? {} : { signal }
  });
  if (result.kind === "answered" && result.status === 200 && isStatusAnswer(result.body)) return result.body;
  throw failureOf(result, connection, "a usage probe");
}
async function requestReload(connection) {
  const result = await controlRequest({ port: connection.port, key: connection.key, method: "POST", path: CONTROL_PATHS.reload });
  if (result.kind === "answered" && result.status === 200 && isPlainObject(result.body) && result.body.ok === true) return;
  throw failureOf(result, connection, "a reload");
}
async function waitForExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (processExists(pid)) {
    if (Date.now() >= deadline) return false;
    await delay2(POLL_MS);
  }
  return true;
}
async function waitForPortFree(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (await portAcceptsConnections(port)) {
    if (Date.now() >= deadline) return false;
    await delay2(POLL_MS);
  }
  return true;
}
async function keyRefusingDaemon(key) {
  const read = readDaemonFile();
  if (read.status !== "ok" || !processExists(read.info.pid)) return null;
  const holder = await portHolder(read.info.port, key, FIND_TIMEOUT_MS);
  return holder.kind === "other" && holder.status === 403 ? read.info : null;
}
function notAnsweringMessage(info, reason, platform) {
  const pid = String(info.pid);
  const stopIt = platform === "win32" ? `taskkill /PID ${pid} /F` : `kill ${pid}`;
  return `The kurmis daemon (pid ${pid}, named in daemon.json) holds port ${String(info.port)} but did not answer a status request (${reason}). It may be busy, or finishing its open requests before it stops. Run the command again in a moment. If it keeps happening, look in ${logPath()}, and stop it with "${stopIt}".`;
}
function keyRefusedMessage(info, platform) {
  const pid = String(info.pid);
  const stopIt = platform === "win32" ? `taskkill /PID ${pid} /F` : `kill ${pid}`;
  return `The program on port ${String(info.port)} refused the key in ${keyPath()}, and daemon.json names pid ${pid} on that port, which still runs. Most likely that is a kurmis daemon started before the key file was changed or deleted, so its key no longer matches the key file. If pid ${pid} is that daemon, stop it with "${stopIt}" and run the command again. If you ran "kurmis setup", run it again after that, so your Claude Code settings hold the key from the key file.`;
}
async function keyRefusedProblem(options) {
  const refusing = await keyRefusingDaemon(readKey() ?? "");
  return refusing === null ? null : keyRefusedMessage(refusing, options.platform ?? process.platform);
}
async function stopDaemon(options) {
  const platform = options.platform ?? process.platform;
  const found = await findDaemon(options);
  if (found === null) {
    const problem = await keyRefusedProblem(options);
    if (problem !== null) throw new DaemonError(problem);
    return false;
  }
  const now = options.now === true;
  const waitMs = options.stopTimeoutMs ?? (now ? NOW_STOP_TIMEOUT_MS : STOP_TIMEOUT_MS);
  const body = { maxWaitMs: now ? 0 : waitMs };
  const result = await controlRequest({ port: found.port, key: found.key, method: "POST", path: CONTROL_PATHS.stop, body });
  if (result.kind === "answered" && result.status !== 200) throw failureOf(result, found, "the stop request");
  const graceMs = platform === "win32" && !now ? options.stopGraceMs ?? STOP_GRACE_MS : 0;
  if (await waitForExit(found.pid, waitMs + graceMs)) return true;
  const kill = options.kill ?? ((pid, signal) => process.kill(pid, signal));
  try {
    kill(found.pid, "SIGTERM");
  } catch (error) {
    const code = error.code;
    if (code === "ESRCH") return true;
    const stopIt = platform === "win32" ? `taskkill /PID ${String(found.pid)} /F` : `kill ${String(found.pid)}`;
    throw new DaemonError(`The kurmis daemon (pid ${String(found.pid)}) was asked to stop but is still running, and this command may not end it (${code ?? String(error)}). It probably runs as another user or as administrator; end it from there with "${stopIt}".`);
  }
  if (await waitForExit(found.pid, KILL_WAIT_MS)) return true;
  throw new DaemonError(`The kurmis daemon (pid ${String(found.pid)}) was asked to stop but is still running.`);
}
async function restartDaemon(options) {
  const version = options.version ?? kurmisVersion;
  const found = await findDaemon(options);
  if (found !== null) {
    if (compareVersions(found.version, version) === 1) {
      throw new DaemonError(`The running kurmis daemon is version ${found.version}, newer than this kurmis (${version}), so this kurmis does not replace it. Update kurmis, or run "kurmis daemon stop" first.`);
    }
    const result = await controlRequest({ port: found.port, key: found.key, method: "POST", path: CONTROL_PATHS.stop });
    if (result.kind === "answered" && result.status !== 200) throw failureOf(result, found, "the stop request");
    if (!await waitForPortFree(found.port, PORT_FREE_TIMEOUT_MS)) {
      throw new DaemonError(`The kurmis daemon (pid ${String(found.pid)}) was asked to stop but still holds port ${String(found.port)}.`);
    }
  }
  const started = await startDaemon(options);
  return { ...started, replaced: found?.version ?? started.replaced };
}
function silentDaemon() {
  const read = readDaemonFile();
  if (read.status !== "ok" || !processExists(read.info.pid)) return null;
  return { pid: read.info.pid, port: read.info.port, version: read.info.version };
}

// src/cli/wrapper.ts
var import_node_child_process3 = require("node:child_process");
var import_node_os6 = require("node:os");
var WRAPPER_PIDS_VARIABLE = "KURMIS_WRAPPER_PIDS";
var MAX_WRAPPER_DEPTH = 8;
function wrapperPids(env) {
  return (env[WRAPPER_PIDS_VARIABLE] ?? "").split(",").map((text2) => Number(text2)).filter((pid) => Number.isInteger(pid) && pid > 0);
}
function wrapperLoop(env, parentPid) {
  const pids = wrapperPids(env);
  if (!pids.includes(parentPid) && pids.length < MAX_WRAPPER_DEPTH) return null;
  return `kurmis was started by the program it started, so that program runs kurmis again instead of being the real one (${pids.includes(parentPid) ? "its parent is a kurmis wrapper" : `${String(pids.length)} kurmis wrappers run inside each other`}). Take that program off PATH, or set KURMIS_CLAUDE_BIN or KURMIS_CODEX_BIN to the real program`;
}
function withWrapperPid(env, pid) {
  return { ...env, [WRAPPER_PIDS_VARIABLE]: [...wrapperPids(env), pid].join(",") };
}
function ignoredSignals(platform, stdinIsTerminal = true) {
  if (platform === "win32") return ["SIGINT", "SIGBREAK", "SIGHUP"];
  return stdinIsTerminal ? ["SIGINT", "SIGQUIT"] : [];
}
function forwardedSignals(platform, stdinIsTerminal = true) {
  if (platform === "win32") return [];
  return stdinIsTerminal ? ["SIGTERM", "SIGHUP"] : ["SIGTERM", "SIGHUP", "SIGINT", "SIGQUIT"];
}
async function runInteractive(spec, options = {}) {
  const platform = options.platform ?? process.platform;
  const proc = options.process ?? process;
  const spawn4 = options.spawn ?? import_node_child_process3.spawn;
  const stdinIsTerminal = options.stdinIsTerminal ?? process.stdin.isTTY === true;
  return await new Promise((resolve8) => {
    const installed = [];
    let child2;
    let started = false;
    let settled = false;
    const finish = (end) => {
      if (settled) return;
      settled = true;
      for (const [signal, listener] of installed) proc.removeListener(signal, listener);
      resolve8(end);
    };
    const forward = (signal) => {
      if (child2?.pid === void 0) return;
      try {
        child2.kill(signal);
      } catch {
      }
    };
    for (const signal of ignoredSignals(platform, stdinIsTerminal)) {
      const listener = () => {
      };
      installed.push([signal, listener]);
      proc.on(signal, listener);
    }
    for (const signal of forwardedSignals(platform, stdinIsTerminal)) {
      const listener = () => forward(signal);
      installed.push([signal, listener]);
      proc.on(signal, listener);
    }
    const guarded = refusedByGuard(spec.command, spec.env, spec.args);
    if (guarded !== null) {
      finish(notStarted(spec.command, Object.assign(new Error(guarded), { code: "EACCES" })));
      return;
    }
    const loop = wrapperLoop(spec.env, options.parentPid ?? process.ppid);
    if (loop !== null) {
      finish(notStarted(spec.command, Object.assign(new Error(loop), { code: "ELOOP" })));
      return;
    }
    try {
      child2 = spawn4(spec.command, spec.args, {
        stdio: "inherit",
        env: withWrapperPid(withGuard(spec.env) ?? spec.env, proc.pid),
        cwd: spec.cwd,
        shell: false,
        // Interactive programs need their console window on Windows, so it is not hidden.
        windowsHide: false
      });
    } catch (error) {
      finish(notStarted(spec.command, error));
      return;
    }
    child2.once("spawn", () => {
      started = true;
    });
    child2.on("error", (error) => {
      if (!started) finish(notStarted(spec.command, error));
    });
    child2.once("exit", (code, signal) => {
      if (signal !== null) finish({ kind: "signal", signal });
      else finish({ kind: "exit", code: code ?? 1 });
    });
  });
}
function notStarted(command, error) {
  const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "UNKNOWN";
  const why = {
    ENOENT: "there is no such program",
    EACCES: "it is not executable, or a folder on the way to it cannot be read",
    EPERM: "the system does not allow starting it",
    ENOEXEC: "it is not a program this system can run",
    EISDIR: "it is a folder"
  };
  const reason = why[code] ?? (error instanceof Error ? error.message : String(error));
  return { kind: "not-started", code, message: `could not start ${command}: ${reason} (${code})` };
}
function notStartedExitCode(code) {
  if (code === "ENOENT") return 127;
  if (code === "EACCES" || code === "EPERM" || code === "ENOEXEC" || code === "EISDIR") return 126;
  return 1;
}
var CORE_SIGNALS = /* @__PURE__ */ new Set([
  "SIGQUIT",
  "SIGABRT",
  "SIGILL",
  "SIGTRAP",
  "SIGFPE",
  "SIGBUS",
  "SIGSEGV",
  "SIGSYS",
  "SIGXCPU",
  "SIGXFSZ",
  "SIGIOT"
]);
function signalExitCode(signal) {
  const number = import_node_os6.constants.signals[signal];
  return 128 + (number ?? 0);
}
function finishLikeChild(end, options) {
  switch (end.kind) {
    case "exit":
      return end.code;
    case "not-started":
      options.stderr.write(`kurmis: ${options.name}: ${end.message}
`);
      return notStartedExitCode(end.code);
    case "signal": {
      const platform = options.platform ?? process.platform;
      if (platform !== "win32" && !CORE_SIGNALS.has(end.signal)) {
        const proc = options.process ?? process;
        proc.removeAllListeners(end.signal);
        try {
          proc.kill(proc.pid, end.signal);
        } catch {
        }
      }
      return signalExitCode(end.signal);
    }
  }
}

// src/cli/command-deps.ts
var realDaemonClient = { findDaemon, ensureDaemon, readStatus: readStatus3, requestProbe, requestReload };
var realChildRunner = { runInteractive, finishLikeChild };
var realFindProgram = findProgram;
var realPrepareCodexHome = prepareCodexHome;
async function reloadIfRunning(client, env) {
  try {
    const connection = await client.findDaemon({ env });
    if (connection === null) return { kind: "not-running" };
    await client.requestReload(connection);
    return { kind: "reloaded" };
  } catch (error) {
    return { kind: "failed", message: error instanceof DaemonError || error instanceof Error ? error.message : String(error) };
  }
}
function reloadText(result) {
  switch (result.kind) {
    case "reloaded":
      return "The running daemon has read the change.";
    case "not-running":
      return null;
    case "failed":
      return `The daemon could not be told about the change (${result.message}); it reads config.json again once it notices the change.`;
  }
}
async function settleWithin(start2, ms) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((resolve8) => {
    timer = setTimeout(() => resolve8({ kind: "timeout" }), ms);
  });
  let promise;
  try {
    promise = start2(controller.signal);
  } catch (error) {
    clearTimeout(timer);
    return { kind: "failed", error };
  }
  const settled = promise.then(
    (value) => ({ kind: "done", value }),
    (error) => ({ kind: "failed", error })
  );
  try {
    const result = await Promise.race([settled, timeout]);
    if (result.kind === "timeout") controller.abort();
    return result;
  } finally {
    clearTimeout(timer);
  }
}

// src/cli/settings-arg.ts
var import_node_crypto8 = require("node:crypto");
var import_node_fs11 = require("node:fs");
var import_node_os7 = require("node:os");
var import_node_path14 = require("node:path");

// src/cli/json-error.ts
var NotJson = class extends Error {
  constructor(at2) {
    super("not JSON");
    this.at = at2;
  }
  at;
};
var WHITESPACE = /* @__PURE__ */ new Set([" ", "	", "\n", "\r"]);
function jsonErrorPlace(text2) {
  let pos = 0;
  const fail4 = () => {
    throw new NotJson(pos);
  };
  const skip = () => {
    while (pos < text2.length && WHITESPACE.has(text2[pos])) pos++;
  };
  const expect = (char) => {
    if (text2[pos] !== char) fail4();
    pos++;
  };
  const string = () => {
    expect('"');
    for (; ; ) {
      if (pos >= text2.length) fail4();
      const char = text2[pos];
      if (char === '"') {
        pos++;
        return;
      }
      if (char.charCodeAt(0) < 32) fail4();
      if (char === "\\") {
        pos++;
        const escaped = text2[pos];
        if (escaped === "u") {
          for (let i = 1; i <= 4; i++) {
            if (!/[0-9a-fA-F]/.test(text2[pos + i] ?? "")) {
              pos += i;
              fail4();
            }
          }
          pos += 5;
          continue;
        }
        if (escaped === void 0 || !'"\\/bfnrt'.includes(escaped)) fail4();
      }
      pos++;
    }
  };
  const digits = () => {
    if (!/[0-9]/.test(text2[pos] ?? "")) fail4();
    while (/[0-9]/.test(text2[pos] ?? "")) pos++;
  };
  const number = () => {
    if (text2[pos] === "-") pos++;
    if (text2[pos] === "0") pos++;
    else digits();
    if (text2[pos] === ".") {
      pos++;
      digits();
    }
    if (text2[pos] === "e" || text2[pos] === "E") {
      pos++;
      if (text2[pos] === "+" || text2[pos] === "-") pos++;
      digits();
    }
  };
  const word = (expected) => {
    for (const char of expected) expect(char);
  };
  const value = () => {
    skip();
    const char = text2[pos];
    if (char === "{") {
      pos++;
      skip();
      if (text2[pos] === "}") {
        pos++;
        return;
      }
      for (; ; ) {
        skip();
        string();
        skip();
        expect(":");
        value();
        skip();
        if (text2[pos] === "}") {
          pos++;
          return;
        }
        expect(",");
      }
    }
    if (char === "[") {
      pos++;
      skip();
      if (text2[pos] === "]") {
        pos++;
        return;
      }
      for (; ; ) {
        value();
        skip();
        if (text2[pos] === "]") {
          pos++;
          return;
        }
        expect(",");
      }
    }
    if (char === '"') return string();
    if (char === "t") return word("true");
    if (char === "f") return word("false");
    if (char === "n") return word("null");
    if (char === "-" || /[0-9]/.test(char ?? "")) return number();
    fail4();
  };
  try {
    value();
    skip();
    if (pos < text2.length) fail4();
    return null;
  } catch (error) {
    if (!(error instanceof NotJson)) throw error;
    return placeOf(text2, Math.min(error.at, text2.length));
  }
}
function placeOf(text2, at2) {
  let line = 1;
  let lineStart2 = 0;
  for (let i = 0; i < at2; i++) {
    if (text2[i] === "\n") {
      line++;
      lineStart2 = i + 1;
    }
  }
  return { line, column: at2 - lineStart2 + 1 };
}
function notJsonText(text2) {
  const place = jsonErrorPlace(text2);
  return place === null ? "not valid JSON" : `not valid JSON (line ${String(place.line)}, column ${String(place.column)})`;
}

// src/cli/settings-arg.ts
var FLAG = "--settings";
function readUserSettingsArg(args, options) {
  const rest = [];
  let value = null;
  let index = 0;
  for (; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--") break;
    if (arg === FLAG) {
      const next = args[index + 1];
      if (next === void 0) return { error: `${FLAG} needs a value: a settings file or a JSON object` };
      value = next;
      index++;
      continue;
    }
    if (arg.startsWith(`${FLAG}=`)) {
      value = arg.slice(FLAG.length + 1);
      continue;
    }
    rest.push(arg);
  }
  rest.push(...args.slice(index));
  if (value === null) return { settings: null, source: null, rest };
  if (value.trim() === "") return { error: `${FLAG} needs a value: a settings file or a JSON object` };
  const text2 = value.trim();
  if (text2.startsWith("{") && text2.endsWith("}")) {
    const settings2 = parseSettings(text2, `the JSON given to ${FLAG}`);
    return "error" in settings2 ? settings2 : { settings: settings2.value, source: "inline", rest };
  }
  const path = (0, import_node_path14.isAbsolute)(value) ? value : (0, import_node_path14.resolve)(options.cwd, value);
  let fileText;
  try {
    fileText = (options.readFile ?? ((file) => (0, import_node_fs11.readFileSync)(file, "utf8")))(path);
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    const why = code === "ENOENT" ? "it does not exist" : error instanceof Error ? error.message : String(error);
    return { error: `${FLAG}: cannot read the settings file ${path}: ${why}` };
  }
  const settings = parseSettings(fileText, `the settings file ${path}`);
  return "error" in settings ? settings : { settings: settings.value, source: path, rest };
}
function parseSettings(text2, what) {
  let value;
  try {
    value = JSON.parse(withoutBom2(text2));
  } catch {
    return { error: `${FLAG}: ${what} is ${notJsonText(withoutBom2(text2))}` };
  }
  if (!isPlainObject2(value)) return { error: `${FLAG}: ${what} is not a JSON object` };
  if (value.env !== void 0 && !isPlainObject2(value.env)) {
    return { error: `${FLAG}: the "env" in ${what} is not an object` };
  }
  return { value };
}
function withoutBom2(text2) {
  return text2.charCodeAt(0) === 65279 ? text2.slice(1) : text2;
}
function isPlainObject2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function routingVariables(routed) {
  const out = {};
  for (const name of ROUTING_VARIABLES) {
    const value = routed.set[name];
    if (value !== void 0) out[name] = value;
  }
  return out;
}
function settingsEnv(routed) {
  const out = routingVariables(routed);
  for (const name of OAUTH_TOKEN_VARIABLES) out[name] = "";
  return out;
}
function mergeRoutingSettings(user, routing) {
  const userEnv = user !== null && isPlainObject2(user.env) ? user.env : {};
  return { ...user ?? {}, env: { ...userEnv, ...routing } };
}
function claudeArgsWithSettings(user, routing, store = storeSettings) {
  const stored = store(JSON.stringify(mergeRoutingSettings(user.settings, routing)), user.settings !== null);
  return { args: [FLAG, stored.path, ...user.rest], remove: () => stored.remove() };
}
var SETTINGS_FILE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1e3;
var SETTINGS_FILE_NAME = /^[0-9a-f]{32}\.json$/;
var RUN_SETTINGS_FILE_NAME = /^run-(\d+)-[0-9a-f]{16}\.json$/;
function storeSettings(text2, holdsUserSettings, folder = wrapperSettingsFolder(), now = Date.now(), pid = process.pid) {
  if (!holdsUserSettings) return { path: storeSettingsFile(text2, folder, now), remove: () => void 0 };
  pruneSettingsFiles(folder, now, null);
  const path = (0, import_node_path14.join)(folder, `run-${String(pid)}-${(0, import_node_crypto8.randomBytes)(8).toString("hex")}.json`);
  writeFileAtomicSync(path, text2, { mode: PRIVATE_FILE_MODE });
  return {
    path,
    remove: () => {
      try {
        (0, import_node_fs11.rmSync)(path, { force: true });
      } catch {
      }
    }
  };
}
function storeSettingsFile(text2, folder = wrapperSettingsFolder(), now = Date.now()) {
  const path = (0, import_node_path14.join)(folder, `${(0, import_node_crypto8.createHash)("sha256").update(text2).digest("hex").slice(0, 32)}.json`);
  let current = false;
  try {
    current = (0, import_node_fs11.readFileSync)(path, "utf8") === text2;
  } catch {
  }
  if (current) {
    try {
      (0, import_node_fs11.utimesSync)(path, now / 1e3, now / 1e3);
    } catch {
    }
  } else {
    writeFileAtomicSync(path, text2, { mode: PRIVATE_FILE_MODE });
  }
  pruneSettingsFiles(folder, now, path);
  return path;
}
function pruneSettingsFiles(folder, now, keep) {
  let names;
  try {
    names = (0, import_node_fs11.readdirSync)(folder);
  } catch {
    return;
  }
  for (const name of names) {
    const file = (0, import_node_path14.join)(folder, name);
    const run2 = RUN_SETTINGS_FILE_NAME.exec(name);
    if (!SETTINGS_FILE_NAME.test(name) && run2 === null || file === keep) continue;
    try {
      const old = now - (0, import_node_fs11.statSync)(file).mtimeMs > SETTINGS_FILE_MAX_AGE_MS;
      if (old || run2 !== null && !isProcessAlive(Number(run2[1]))) (0, import_node_fs11.rmSync)(file, { force: true });
    } catch {
    }
  }
}
function claudeUserSettingsPath(env, home = (0, import_node_os7.homedir)()) {
  const configDir = env.CLAUDE_CONFIG_DIR;
  return configDir !== void 0 && configDir !== "" ? (0, import_node_path14.join)(configDir, "settings.json") : (0, import_node_path14.join)(home, ".claude", "settings.json");
}
function readUserSettingsEnv(path, readFile3 = (file) => (0, import_node_fs11.readFileSync)(file, "utf8")) {
  let text2;
  try {
    text2 = readFile3(path);
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if (code === "ENOENT" || code === "ENOTDIR") return { env: null, warning: null };
    return { env: null, warning: `could not read ${path} (${error instanceof Error ? error.message : String(error)})` };
  }
  let value;
  try {
    value = JSON.parse(withoutBom2(text2));
  } catch {
    return { env: null, warning: `${path} is ${notJsonText(withoutBom2(text2))}, so custom headers set there are not kept` };
  }
  if (!isPlainObject2(value) || !isPlainObject2(value.env)) return { env: null, warning: null };
  return { env: value.env, warning: null };
}
var CUSTOM_HEADERS = "ANTHROPIC_CUSTOM_HEADERS";
function inheritedVariable(layers, variable) {
  for (const env of [layers.flagEnv, layers.userSettingsEnv]) {
    if (env === null || !(variable in env)) continue;
    const value = env[variable];
    if (typeof value === "string") return value;
  }
  for (const [name, value] of Object.entries(layers.processEnv)) {
    const same2 = layers.windows === true ? name.toUpperCase() === variable.toUpperCase() : name === variable;
    if (same2 && value !== void 0) return value;
  }
  return null;
}
function inheritedCustomHeaders(layers) {
  return inheritedVariable(layers, CUSTOM_HEADERS);
}
function userOwnedRoutingVariables(layers) {
  return USER_OWNED_ROUTING_VARIABLES.filter((name) => {
    for (const env of [layers.flagEnv, layers.userSettingsEnv]) {
      if (env !== null && env[name] !== void 0 && env[name] !== null && env[name] !== "") return true;
    }
    const value = inheritedVariable({ flagEnv: null, userSettingsEnv: null, processEnv: layers.processEnv, windows: layers.windows }, name);
    return value !== null && value !== "";
  });
}

// src/cli/login-names.ts
var PROVIDER_NAMES2 = { claude: "Claude", codex: "Codex" };
function machineOwnText(provider) {
  return `the login plain ${provider} uses`;
}
function loginArgument(config, login) {
  const found = resolveLogin(config, login.alias);
  return "login" in found && found.login.id === login.id ? login.alias : `${login.provider}:${login.alias}`;
}

// src/cli/wrapper-args.ts
function parseWrapperArgs(args) {
  const result = { help: false, login: null, passThrough: [] };
  let index = 0;
  while (index < args.length) {
    const arg = args[index];
    if (arg === "--") {
      index++;
      break;
    }
    if (isHelpFlag(arg)) {
      result.help = true;
      index++;
      continue;
    }
    let value;
    if (arg === "--login") {
      value = args[index + 1];
      index += 2;
    } else if (arg.startsWith("--login=")) {
      value = arg.slice("--login=".length);
      index++;
    } else {
      break;
    }
    if (value === void 0 || value === "") return { error: "--login needs the alias or id of a login, for example --login work-example" };
    if (result.login !== null) return { error: "--login was given twice" };
    result.login = value;
  }
  result.passThrough = args.slice(index);
  return result;
}

// src/cli/commands/claude.ts
var USAGE = `Usage: kurmis claude [--login <login>] [--] [claude arguments...]

Starts Claude Code with the terminal attached. Its requests go through the kurmis daemon,
which signs each one with a login that has room, and the command exits with claude's exit code.
The daemon is started first when it is not running.

Options (only before the first argument kurmis does not know):
  --login <login>   Keep the session on one Claude login, whatever its limits say. <login> is
                    the login's alias or its id, as "kurmis list" shows them, for example
                    --login work-example. Only Claude logins are looked at, so a Codex login
                    with the same alias does not count. Without --login the session is on Auto.
  -h, --help        Show this help.
  --                Pass everything after it to claude, even arguments kurmis knows.

Everything from the first argument kurmis does not know is passed to claude unchanged, except
claude's --settings: kurmis passes its own settings that way, and adds them to yours when you
give one (your file is not changed).
"kurmis claude -- --help" shows claude's own help.`;
function createClaudeCommand(overrides = {}) {
  const deps = {
    daemon: realDaemonClient,
    child: realChildRunner,
    findProgram: realFindProgram,
    loadConfig: () => loadConfig(),
    platform: process.platform,
    cwd: () => process.cwd(),
    homeDir: () => (0, import_node_os8.homedir)(),
    folderExists: (path) => (0, import_node_fs12.existsSync)(path) && (0, import_node_fs12.statSync)(path).isDirectory(),
    storeSettings: (text2, holdsUserSettings) => storeSettings(text2, holdsUserSettings),
    ...overrides
  };
  return {
    name: "claude",
    summary: "Start Claude Code routed through the kurmis daemon",
    usage: USAGE,
    passesArguments: true,
    run: (args, context) => runClaude(args, context, deps)
  };
}
var claudeCommand = createClaudeCommand();
async function runClaude(args, context, deps) {
  const parsed = parseWrapperArgs(args);
  if ("error" in parsed) return usageError("claude", parsed.error, context);
  if (parsed.help) {
    writeLine(context.stdout, USAGE);
    return EXIT_OK;
  }
  const fail4 = (message, code = EXIT_FAILURE) => {
    writeLine(context.stderr, `kurmis claude: ${message}`);
    return code;
  };
  const userSettings = readUserSettingsArg(parsed.passThrough, { cwd: deps.cwd(), readFile: deps.readFile });
  if ("error" in userSettings) return fail4(userSettings.error);
  let program;
  try {
    program = deps.findProgram("claude", { env: context.env, platform: deps.platform });
  } catch (error) {
    if (error instanceof ProgramNotFoundError) return fail4(error.message, notStartedExitCode("ENOENT"));
    return fail4(messageOf(error));
  }
  let config;
  try {
    config = deps.loadConfig();
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    return fail4(error.message);
  }
  let pinned = null;
  if (parsed.login !== null) {
    const resolved = resolveLogin(config, parsed.login, "claude");
    if ("error" in resolved) {
      return fail4(`${resolved.error}. "kurmis list" shows the logins, and "kurmis login claude" adds one.`);
    }
    pinned = resolved.login;
  }
  let connection;
  try {
    connection = await deps.daemon.ensureDaemon({ env: context.env });
  } catch (error) {
    return fail4(daemonUnreachable(error));
  }
  let startedOn;
  if (pinned !== null) {
    startedOn = pinned;
  } else {
    let status2;
    try {
      status2 = await deps.daemon.readStatus(connection);
    } catch (error) {
      return fail4(daemonUnreachable(error));
    }
    const startId = autoStartLogin(startableLogins(status2));
    startedOn = status2.logins.find((login) => login.id === startId) ?? machineOwnLogin(config, "claude");
    if (!startedOn.machineOwn) {
      const own2 = status2.logins.find((login) => login.provider === "claude" && login.machineOwn) ?? machineOwnLogin(config, "claude");
      writeLine(context.stderr, `kurmis claude: ${own2.alias}, ${machineOwnText("claude")}, is not signed in, so claude starts on ${startedOn.alias}'s credentials; requests are still routed on Auto.`);
    }
  }
  let secureStorageDir = null;
  if (!startedOn.machineOwn) {
    secureStorageDir = loginFolder({ id: startedOn.id, provider: "claude", machineOwn: false });
    if (!deps.folderExists(secureStorageDir)) {
      return fail4(`the folder of ${startedOn.alias} is missing (${secureStorageDir}). Sign it in again with "kurmis login ${loginArgument(config, { id: startedOn.id, provider: "claude", alias: startedOn.alias })}".`);
    }
  }
  if (startedOn.machineOwn && configDirHasOwnCredentials(context.env, deps.platform)) {
    writeLine(context.stderr, `kurmis claude: ${configDirNote(context.env["CLAUDE_CONFIG_DIR"] ?? "", deps)}`);
  }
  const layers = settingsLayers(userSettings, context.env, deps);
  if (layers.warning !== null) writeLine(context.stderr, `kurmis claude: ${layers.warning}`);
  const routed = withoutRoutedVariables(routedClaudeEnv({
    port: connection.port,
    key: connection.key,
    login: pinned?.id ?? null,
    startedOn: startedOn.id,
    secureStorageDir,
    inheritedCustomHeaders: inheritedCustomHeaders(layers.layers)
  }), userOwnedRoutingVariables(layers.layers));
  for (const note of oauthTokenNotes(context.env, layers.layers, userSettings, claudeUserSettingsPath(context.env, deps.homeDir()))) {
    writeLine(context.stderr, `kurmis claude: ${note}`);
  }
  const env = applyRoutedEnv(context.env, routed, deps.platform === "win32");
  let claudeArgs;
  try {
    claudeArgs = claudeArgsWithSettings(userSettings, settingsEnv(routed), deps.storeSettings);
  } catch (error) {
    return fail4(`could not write the settings file for claude: ${error instanceof Error ? error.message : String(error)}`);
  }
  let end;
  try {
    end = await deps.child.runInteractive(
      { command: program.command, args: [...program.args, ...claudeArgs.args], env },
      { platform: deps.platform }
    );
  } finally {
    claudeArgs.remove();
  }
  return deps.child.finishLikeChild(end, { stderr: context.stderr, name: "claude", platform: deps.platform });
}
function startableLogins(status2) {
  return status2.logins.filter((login) => login.provider === "claude").map((login) => ({
    id: login.id,
    machineOwn: login.machineOwn,
    loggedIn: login.signedIn ?? login.machineOwn,
    autoRoute: login.routing
  }));
}
function settingsLayers(userSettings, env, deps) {
  const flagEnv = userSettings.settings?.env;
  const fromFile = readUserSettingsEnv(claudeUserSettingsPath(env, deps.homeDir()), deps.readFile);
  return {
    layers: {
      flagEnv: typeof flagEnv === "object" && flagEnv !== null && !Array.isArray(flagEnv) ? flagEnv : null,
      userSettingsEnv: fromFile.env,
      processEnv: env,
      windows: deps.platform === "win32"
    },
    warning: fromFile.warning
  };
}
function configDirNote(value, deps) {
  if (namesDefaultClaudeFolder(value, deps.platform, deps.homeDir())) {
    const keeps = deps.platform === "win32" ? "may keep its credentials in a Credential Manager entry" : "keeps its credentials in a Keychain item";
    return `CLAUDE_CONFIG_DIR names ~/.claude, the folder of the login plain claude uses, but a claude started with it set ${keeps} of its own, which may hold another account. Kurmis starts claude with the credentials of the login plain claude uses, the ones a claude without CLAUDE_CONFIG_DIR reads.`;
  }
  return "CLAUDE_CONFIG_DIR is set, but kurmis starts claude on the login plain claude uses, the one in ~/.claude, so claude signs in with that login's credentials, not with those in CLAUDE_CONFIG_DIR. Settings and transcripts still come from CLAUDE_CONFIG_DIR.";
}
function oauthTokenNotes(env, layers, userSettings, userSettingsPath) {
  const windows = layers.windows === true;
  const listed = (names) => ({
    names: names.join(" and "),
    verb: names.length === 1 ? "is" : "are",
    pronoun: names.length === 1 ? "it" : "them"
  });
  const notes = [];
  const inherited = inheritedOAuthTokenVariables(env, windows);
  if (inherited.length > 0) {
    const said = listed(inherited);
    notes.push(`${said.names} ${said.verb} set, so claude would sign its requests with that token instead of a kurmis login. Kurmis starts claude without ${said.pronoun}; unset ${said.pronoun} to stop this note.`);
  }
  const flagWhere = userSettings.source === "inline" || userSettings.source === null ? "your --settings" : userSettings.source;
  for (const [where, layer] of [[userSettingsPath, layers.userSettingsEnv], [flagWhere, layers.flagEnv]]) {
    if (layer === null) continue;
    const names = Object.entries(layer).filter(([name, value]) => typeof value === "string" && value !== "" && OAUTH_TOKEN_VARIABLES.some((other) => windows ? other.toUpperCase() === name.toUpperCase() : other === name)).map(([name]) => name);
    if (names.length === 0) continue;
    const said = listed(names);
    notes.push(`${said.names} ${said.verb} set in the "env" of ${where}, so claude would sign its requests with that token instead of a kurmis login. Kurmis sets ${said.pronoun} to an empty value for this claude, which Claude Code reads as unset; remove ${said.pronoun} there to stop this note.`);
  }
  return notes;
}
function daemonUnreachable(error) {
  return `the kurmis daemon could not be reached (${messageOf(error)}). Start it with "kurmis daemon start"; its log is ${logPath()}. Claude is not started unrouted.`;
}
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

// src/cli/commands/codex.ts
var CODEX_PROBE_WAIT_MS = 5e3;
var USAGE2 = `Usage: kurmis codex [--login <login>] [--] [codex arguments...]

Starts Codex with the terminal attached, on the login that ranks first (the same order Claude's
Auto uses) or on the one named, and exits with codex's exit code. Without --login the daemon is
asked for each login's usage, and started first when it is not running.

Options (only before the first argument kurmis does not know):
  --login <login>   Start on this Codex login. <login> is the login's alias or its id, as
                    "kurmis list" shows them, for example --login work-example. Only Codex
                    logins are looked at, so a Claude login with the same alias does not count.
  -h, --help        Show this help.
  --                Pass everything after it to codex, even arguments kurmis knows.

Everything from the first argument kurmis does not know is passed to codex unchanged.
"kurmis codex -- --help" shows codex's own help.`;
function createCodexCommand(overrides = {}) {
  const deps = {
    daemon: realDaemonClient,
    child: realChildRunner,
    findProgram: realFindProgram,
    prepareCodexHome: realPrepareCodexHome,
    loadConfig: () => loadConfig(),
    now: Date.now,
    platform: process.platform,
    probeWaitMs: CODEX_PROBE_WAIT_MS,
    ...overrides
  };
  return {
    name: "codex",
    summary: "Start Codex on a login that has room",
    usage: USAGE2,
    passesArguments: true,
    run: (args, context) => runCodex(args, context, deps)
  };
}
var codexCommand = createCodexCommand();
async function runCodex(args, context, deps) {
  const parsed = parseWrapperArgs(args);
  if ("error" in parsed) return usageError("codex", parsed.error, context);
  if (parsed.help) {
    writeLine(context.stdout, USAGE2);
    return EXIT_OK;
  }
  let program;
  try {
    program = deps.findProgram("codex", { env: context.env, platform: deps.platform });
  } catch (error) {
    writeLine(context.stderr, `kurmis codex: ${messageOf2(error)}`);
    return error instanceof ProgramNotFoundError ? notStartedExitCode("ENOENT") : EXIT_FAILURE;
  }
  const prepared = await preparedHome(parsed.login, context, deps);
  if (prepared === null) return EXIT_FAILURE;
  for (const warning of prepared.warnings) writeLine(context.stderr, `kurmis codex: ${warning}`);
  const env = applyEnvPatch(context.env, codexHomePatch(prepared, context.env, deps.platform), deps.platform === "win32");
  const end = await deps.child.runInteractive(
    { command: program.command, args: [...program.args, ...parsed.passThrough], env },
    { platform: deps.platform }
  );
  return deps.child.finishLikeChild(end, { stderr: context.stderr, name: "codex", platform: deps.platform });
}
async function preparedHome(named, context, deps) {
  let config;
  try {
    config = deps.loadConfig();
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    if (named !== null) {
      writeLine(context.stderr, `kurmis codex: ${error.message}`);
      return null;
    }
    writeLine(context.stderr, `kurmis codex: ${error.message} Starting on ${machineOwnText("codex")}.`);
    return { codexHome: null, warnings: [] };
  }
  let login;
  if (named !== null) {
    const resolved = resolveLogin(config, named, "codex");
    if ("error" in resolved) {
      writeLine(context.stderr, `kurmis codex: ${resolved.error}. "kurmis list" shows the logins, and "kurmis login codex" adds one.`);
      return null;
    }
    login = resolved.login;
  } else {
    login = await chooseLogin(context, config, deps);
  }
  try {
    return await deps.prepareCodexHome(login, { env: context.env, platform: deps.platform });
  } catch (error) {
    writeLine(context.stderr, `kurmis codex: could not prepare the Codex home of ${login.alias}: ${messageOf2(error)}`);
    return null;
  }
}
function codexHomePatch(prepared, env, platform) {
  if (prepared.codexHome !== null) return { CODEX_HOME: prepared.codexHome };
  const windows = platform === "win32";
  const inherited = windows ? Object.entries(env).find(([name]) => name.toUpperCase() === "CODEX_HOME")?.[1] : env.CODEX_HOME;
  return isKurmisCodexHome(inherited, providerFolder("codex"), windows) ? { CODEX_HOME: void 0 } : {};
}
async function chooseLogin(context, config, deps) {
  const own2 = machineOwnLogin(config, "codex");
  let status2;
  try {
    const connection = await deps.daemon.ensureDaemon({ env: context.env });
    status2 = await deps.daemon.readStatus(connection);
    const stale = codexLoginsToProbe(status2, deps.now());
    if (stale.length > 0) {
      const probed = await settleWithin((signal) => deps.daemon.requestProbe(connection, stale, signal), deps.probeWaitMs);
      if (probed.kind === "done") {
        status2 = probed.value;
      } else {
        const why = probed.kind === "timeout" ? `did not finish within ${String(deps.probeWaitMs / 1e3)} s` : `failed (${messageOf2(probed.error)})`;
        writeLine(context.stderr, `kurmis codex: the usage probe ${why}; choosing with the usage read before.`);
      }
    }
  } catch (error) {
    writeLine(
      context.stderr,
      `kurmis codex: the kurmis daemon could not be reached (${messageOf2(error)}); starting on ${own2.alias}, ${machineOwnText("codex")}.`
    );
    return own2;
  }
  const choice = chooseCodexLogin(status2, deps.now());
  const chosen = findLogin(config, choice.login) ?? own2;
  if (choice.note !== null) {
    writeLine(context.stderr, `kurmis codex: ${choice.note}`);
  } else if (status2.logins.filter((row) => row.provider === "codex").length > 1) {
    writeLine(context.stderr, `kurmis codex: starting on ${chosen.alias}.`);
  }
  return chosen;
}
function messageOf2(error) {
  return error instanceof Error ? error.message : String(error);
}

// src/daemon/main.ts
var import_node_http3 = require("node:http");

// src/data/log.ts
var import_node_fs13 = require("node:fs");
var import_node_path15 = require("node:path");
var LOG_EVENTS = [
  "daemon_started",
  "daemon_stopping",
  "daemon_stopped",
  "daemon_replacing_older",
  "drain_cut_short",
  "port_in_use",
  "config_loaded",
  "config_invalid",
  "alias_write_failed",
  "state_loaded",
  "state_write_failed",
  "control_request",
  "control_rejected",
  "proxy_rejected",
  "request_forwarded",
  "request_failed",
  "retry_other_login",
  "retry_after_backoff",
  "pool_exhausted",
  "cooldown_started",
  "cooldown_ended",
  "session_placed",
  "session_moved",
  "session_hold_ended",
  "token_read_failed",
  "token_renewal_started",
  "token_renewal_finished",
  "usage_probe_started",
  "usage_probe_finished",
  "usage_probe_failed",
  "internal_error"
];
var LOG_REASONS = [
  "usage_limit",
  "overload",
  "unauthorized",
  "bad_secret",
  "no_credentials",
  "token_expired",
  "timeout",
  /** A program the daemon started (a usage probe's CLI) ended before it answered. */
  "exited",
  "network",
  "upstream_error",
  "invalid",
  "missing",
  "corrupt",
  "wrong_version",
  "shutdown",
  "signal",
  "replaced",
  "error",
  "config_changed",
  "pinned",
  "out_of_pool",
  // The macOS Keychain refused the read: it is locked, or the daemon runs in an ssh session.
  "not_allowed",
  "other"
];
var LOG_ERROR_CODES = [
  "EADDRINUSE",
  "EACCES",
  "EPERM",
  "EBUSY",
  "ENOENT",
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ABORT_ERR",
  "other"
];
var LOG_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "other"];
var isNumber = (value) => typeof value === "number" && !Number.isNaN(value);
var oneOf = (words) => (value) => typeof value === "string" && words.includes(value);
var FIELD_CHECKS = {
  login: isLoginId,
  fromLogin: isLoginId,
  provider: isLoginProvider,
  reason: oneOf(LOG_REASONS),
  code: oneOf(LOG_ERROR_CODES),
  method: oneOf(LOG_METHODS),
  status: isNumber,
  ms: isNumber,
  attempt: isNumber,
  count: isNumber,
  port: isNumber,
  pid: isNumber,
  until: isNumber,
  ok: (value) => typeof value === "boolean"
};
var REDACTED = "[redacted]";
function errorCodeOf(error) {
  const code = error?.code;
  return typeof code === "string" && LOG_ERROR_CODES.includes(code) ? code : "other";
}
function methodOf(method) {
  return method !== void 0 && LOG_METHODS.includes(method) ? method : "other";
}
function formatLogLine(event, fields = {}, now = Date.now()) {
  const name = LOG_EVENTS.includes(event) ? event : "invalid_event";
  const parts = [new Date(now).toISOString(), name];
  for (const [key, value] of Object.entries(fields)) {
    if (value === void 0) continue;
    const check = Object.hasOwn(FIELD_CHECKS, key) ? FIELD_CHECKS[key] : void 0;
    if (check === void 0) parts.push(`${REDACTED}=${REDACTED}`);
    else parts.push(`${key}=${check(value) ? String(value) : REDACTED}`);
  }
  return `${parts.join(" ")}
`;
}
var DEFAULT_LOG_MAX_BYTES = 5 * 1024 * 1024;
function openDaemonLog(options = {}) {
  const path = options.path ?? logPath();
  const previous = options.previousPath ?? (options.path === void 0 ? previousLogPath() : `${path}.1`);
  const maxBytes = options.maxBytes ?? DEFAULT_LOG_MAX_BYTES;
  const now = options.now ?? Date.now;
  let size = null;
  const currentSize = () => {
    try {
      return (0, import_node_fs13.statSync)(path).size;
    } catch {
      return 0;
    }
  };
  const rotate = () => {
    try {
      retryWhileLockedSync(() => (0, import_node_fs13.renameSync)(path, previous));
    } catch {
      (0, import_node_fs13.rmSync)(path, { force: true });
    }
    size = 0;
  };
  return {
    write(event, fields) {
      try {
        const line = formatLogLine(event, fields, now());
        const bytes = Buffer.byteLength(line);
        if (size === null) {
          makePrivateDirSync((0, import_node_path15.dirname)(path));
          size = currentSize();
        }
        if (size + bytes > maxBytes) {
          size = currentSize();
          if (size + bytes > maxBytes && size > 0) rotate();
        }
        (0, import_node_fs13.appendFileSync)(path, line, { mode: PRIVATE_FILE_MODE });
        size += bytes;
      } catch {
      }
    }
  };
}

// src/data/identity.ts
var import_node_fs14 = require("node:fs");
var import_node_os9 = require("node:os");
var import_node_path16 = require("node:path");
var CLAUDE_PROFILE_FILE = ".claude.json";
function claudeIdentityFiles(login, home = (0, import_node_os9.homedir)()) {
  if (login.machineOwn) {
    return [(0, import_node_path16.join)(ownClaudeProbeFolder(), CLAUDE_PROFILE_FILE), (0, import_node_path16.join)(home, CLAUDE_PROFILE_FILE)];
  }
  return [(0, import_node_path16.join)(loginFolder(login), CLAUDE_PROFILE_FILE)];
}
function parseClaudeIdentity(text2) {
  try {
    const parsed = JSON.parse(text2);
    if (parsed === null || typeof parsed !== "object") return null;
    const block = parsed["oauthAccount"];
    if (block === null || typeof block !== "object") return null;
    const oauth = block;
    const identity = {
      accountUuid: textOf(oauth["accountUuid"]),
      email: textOf(oauth["emailAddress"]),
      organizationUuid: textOf(oauth["organizationUuid"]),
      organizationName: textOf(oauth["organizationName"])
    };
    return identity.accountUuid === null && identity.email === null ? null : identity;
  } catch {
    return null;
  }
}
function textOf(value) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}
var ClaudeIdentityReader = class {
  constructor(home = import_node_os9.homedir) {
    this.home = home;
  }
  home;
  cache = /* @__PURE__ */ new Map();
  /** The login's identity from the first of its files that names somebody, or null. */
  read(login) {
    for (const file of claudeIdentityFiles(login, this.home())) {
      const value = this.readFile(file);
      if (value !== null) return value;
    }
    return null;
  }
  readFile(file) {
    try {
      const stat2 = (0, import_node_fs14.statSync)(file);
      const cached = this.cache.get(file);
      if (cached?.mtime === stat2.mtimeMs && cached.size === stat2.size) return cached.value;
      let value = null;
      try {
        value = parseClaudeIdentity((0, import_node_fs14.readFileSync)(file, "utf8"));
      } catch {
      }
      this.cache.set(file, { mtime: stat2.mtimeMs, size: stat2.size, value });
      return value;
    } catch {
      this.cache.delete(file);
      return null;
    }
  }
};
function readClaudeIdentity(login, home = (0, import_node_os9.homedir)()) {
  return new ClaudeIdentityReader(() => home).read(login);
}

// src/platform/frame-process.ts
var import_node_child_process4 = require("node:child_process");
var import_node_timers2 = require("node:timers");
var DEFAULT_MAX_FRAME_BYTES = 1024 * 1024;
var DEFAULT_MAX_OUTPUT_BYTES2 = 8 * 1024 * 1024;
var PIPE_CLOSE_WAIT_MS = 1e3;
function treeKillCommand(pid, platform, env) {
  if (platform !== "win32") return null;
  return { command: systemProgram("taskkill", env), args: ["/PID", String(pid), "/T", "/F"] };
}
function createLineSplitter(maxLineBytes, onLine) {
  let pending = [];
  let pendingBytes = 0;
  return (chunk) => {
    let start2 = 0;
    for (; ; ) {
      const newline2 = chunk.indexOf(10, start2);
      if (newline2 === -1) break;
      const piece = chunk.subarray(start2, newline2);
      if (pendingBytes + piece.length > maxLineBytes) return false;
      const line = pendingBytes === 0 ? piece : Buffer.concat([...pending, piece]);
      pending = [];
      pendingBytes = 0;
      onLine(line.toString("utf8").replace(/\r$/, ""));
      start2 = newline2 + 1;
    }
    if (start2 < chunk.length) {
      const rest = chunk.subarray(start2);
      pending.push(rest);
      pendingBytes += rest.length;
    }
    return pendingBytes <= maxLineBytes;
  };
}
function startFrameProcess(program, args, options) {
  const platform = options.platform ?? process.platform;
  const invocation = invocationFor(program, args);
  if ("refused" in invocation) return endedBeforeStart("refused", null);
  if (refusedByGuard(invocation.command, options.env, invocation.args) !== null) return endedBeforeStart("refused", null);
  if (options.signal?.aborted === true) return endedBeforeStart("aborted", null);
  let child2;
  try {
    child2 = (0, import_node_child_process4.spawn)(invocation.command, invocation.args, {
      stdio: ["pipe", "pipe", "ignore"],
      env: withGuard(options.env),
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      // Its own process group on macOS and Linux, so a kill reaches what it started. Never on
      // Windows, where `detached` would give the program a console window of its own.
      detached: platform !== "win32"
    });
  } catch (error) {
    return endedBeforeStart("start_failed", errorCode3(error));
  }
  const stdin = child2.stdin;
  const stdout = child2.stdout;
  if (stdin === null || stdout === null) {
    child2.kill("SIGKILL");
    return endedBeforeStart("start_failed", null);
  }
  const maxFrame = options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
  const maxOutput = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES2;
  let cause = null;
  let inputOpen = true;
  let outputBytes = 0;
  let exitedAt = null;
  let settled = false;
  let pipeTimer;
  let graceTimer;
  let resolveExited;
  const exited = new Promise((resolve8) => {
    resolveExited = resolve8;
  });
  const finish = (exit) => {
    if (settled) return;
    settled = true;
    (0, import_node_timers2.clearTimeout)(deadline);
    (0, import_node_timers2.clearTimeout)(pipeTimer);
    (0, import_node_timers2.clearTimeout)(graceTimer);
    options.signal?.removeEventListener("abort", onAbort);
    inputOpen = false;
    stdin.destroy();
    stdout.destroy();
    resolveExited(exit);
  };
  const kill = (why) => {
    if (settled) return;
    cause ??= why;
    inputOpen = false;
    killTree(child2, platform, options.env);
    stdin.destroy();
    stdout.destroy();
  };
  const deadline = (0, import_node_timers2.setTimeout)(() => kill("timeout"), options.timeoutMs);
  const onAbort = () => kill("aborted");
  options.signal?.addEventListener("abort", onAbort, { once: true });
  stdin.on("error", () => {
    inputOpen = false;
  });
  const split = createLineSplitter(maxFrame, (line) => {
    if (cause !== null || line.trim() === "") return;
    let frame;
    try {
      frame = JSON.parse(line);
    } catch {
      return;
    }
    options.onFrame(frame);
  });
  stdout.on("data", (chunk) => {
    if (cause !== null) return;
    outputBytes += chunk.length;
    if (!split(chunk) || outputBytes > maxOutput) kill("output_too_large");
  });
  stdout.on("error", () => void 0);
  child2.on("error", (error) => {
    if (child2.pid === void 0) finish({ end: "start_failed", code: null, signal: null, errorCode: errorCode3(error) });
  });
  child2.on("exit", (code, signal) => {
    exitedAt = { code, signal };
    pipeTimer = (0, import_node_timers2.setTimeout)(() => stdout.destroy(), PIPE_CLOSE_WAIT_MS);
  });
  child2.on("close", (code, signal) => {
    const status2 = exitedAt ?? { code, signal };
    finish({
      end: cause ?? "exited",
      code: cause === null ? status2.code : null,
      signal: status2.signal,
      errorCode: null
    });
  });
  const endInput = () => {
    if (!inputOpen) return;
    inputOpen = false;
    stdin.end();
  };
  return {
    pid: child2.pid,
    exited,
    send(frame) {
      if (!inputOpen || settled) return;
      stdin.write(`${JSON.stringify(frame)}
`);
    },
    endInput,
    close(graceMs) {
      endInput();
      if (!settled && graceTimer === void 0) graceTimer = (0, import_node_timers2.setTimeout)(() => kill("close_timeout"), graceMs);
      return exited;
    },
    kill() {
      kill("killed");
    }
  };
}
function endedBeforeStart(end, code) {
  const exit = { end, code: null, signal: null, errorCode: code };
  const exited = Promise.resolve(exit);
  return {
    pid: void 0,
    exited,
    send: () => void 0,
    endInput: () => void 0,
    close: () => exited,
    kill: () => void 0
  };
}
function killTree(child2, platform, env) {
  const pid = child2.pid;
  if (pid === void 0 || child2.exitCode !== null || child2.signalCode !== null) return;
  const command = treeKillCommand(pid, platform, env);
  if (command === null) {
    try {
      process.kill(-pid, "SIGKILL");
      return;
    } catch {
      child2.kill("SIGKILL");
      return;
    }
  }
  const fallback = () => {
    if (child2.exitCode === null && child2.signalCode === null) child2.kill("SIGKILL");
  };
  const invocation = invocationFor(command.command, command.args);
  if ("refused" in invocation || refusedByGuard(invocation.command, env, invocation.args) !== null) {
    fallback();
    return;
  }
  try {
    const taskkill = (0, import_node_child_process4.spawn)(invocation.command, invocation.args, { stdio: "ignore", shell: false, windowsHide: true, env: withGuard(env) });
    taskkill.on("error", fallback);
    taskkill.on("exit", fallback);
  } catch {
    fallback();
  }
}
function errorCode3(error) {
  const code = error?.code;
  return typeof code === "string" ? code : null;
}

// src/daemon/probe-result.ts
var PROBE_CLOSE_GRACE_MS = 5e3;
function programMissingText(tool) {
  const product = tool === "claude" ? "Claude Code" : "Codex";
  const variable = tool === "claude" ? "KURMIS_CLAUDE_BIN" : "KURMIS_CODEX_BIN";
  return `The ${tool} program was not found on the PATH the kurmis daemon was started with. Install ${product}, or put ${tool} on PATH, and run "kurmis daemon restart" from a shell that finds it; or set ${variable} to the program.`;
}
function probeFailure(signedIn, reason, error) {
  return { ok: false, signedIn, reason, error };
}
function abortedProbe(signedIn) {
  return probeFailure(signedIn, "shutdown", "The usage probe was stopped because the daemon is shutting down.");
}
function seconds(ms) {
  return String(Math.round(ms / 100) / 10);
}
function failureForExit(program, exit, timeoutMs, signedIn) {
  switch (exit.end) {
    case "aborted":
      return abortedProbe(signedIn);
    case "timeout":
      return probeFailure(signedIn, "timeout", `The usage probe timed out after ${seconds(timeoutMs)} s.`);
    case "output_too_large":
      return probeFailure(signedIn, "invalid", `${program} printed more output than the usage probe accepts.`);
    case "refused":
      return probeFailure(signedIn, "invalid", `${program} is a batch file, which kurmis never starts.`);
    case "start_failed":
      return probeFailure(signedIn, "missing", exit.errorCode === null ? `${program} could not be started.` : `${program} could not be started (${safeCode(exit.errorCode)}).`);
    case "close_timeout":
    case "killed":
    case "exited":
      if (exit.code !== null) {
        return probeFailure(signedIn, "exited", `${program} exited with code ${String(exit.code)} before it answered.`);
      }
      return probeFailure(signedIn, "exited", exit.signal === null ? `${program} ended before it answered.` : `${program} was ended by ${exit.signal} before it answered.`);
  }
}
function safeCode(code) {
  return /^[A-Z0-9_]{1,32}$/.test(code) ? code : "unknown error";
}
function replyOrExit(reply, exited) {
  return Promise.race([
    reply.then((value) => ({ kind: "reply", value })),
    exited.then((exit) => ({ kind: "ended", exit }))
  ]);
}
var PendingReplies = class {
  waiting = /* @__PURE__ */ new Map();
  /** A promise for the reply to request `id`. Ask for it before the request is sent. */
  wait(id) {
    return new Promise((resolve8) => {
      this.waiting.set(id, resolve8);
    });
  }
  /** Hands a reply to whoever waits for it. A reply nobody waits for is dropped. */
  settle(id, value) {
    const resolve8 = this.waiting.get(id);
    if (resolve8 === void 0) return;
    this.waiting.delete(id);
    resolve8(value);
  }
};

// src/daemon/claude-probe.ts
var CLAUDE_PROBE_TIMEOUT_MS = 3e4;
var CLAUDE_PROBE_ARGS = [
  "-p",
  "--input-format",
  "stream-json",
  "--output-format",
  "stream-json",
  // The CLI refuses stream-json output without it.
  "--verbose",
  "--setting-sources=",
  "--strict-mcp-config",
  "--mcp-config",
  '{"mcpServers":{}}',
  "--no-session-persistence"
];
var TOKEN_VARIABLES = { CLAUDE_CODE_OAUTH_TOKEN: void 0, CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: void 0 };
var PROBE_SETTINGS = { DISABLE_AUTOUPDATER: "1" };
async function probeClaudeUsage(login, options) {
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? CLAUDE_PROBE_TIMEOUT_MS;
  if (options.signal?.aborted === true) return abortedProbe(null);
  let program;
  try {
    program = findProgram("claude", { env: options.env });
  } catch (error) {
    if (error instanceof ProgramNotFoundError) {
      return probeFailure(null, "missing", programMissingText("claude"));
    }
    return probeFailure(null, "other", "The claude program could not be looked up.");
  }
  const env = applyEnvPatch(options.env, { ...claudeProbeEnv(login), ...TOKEN_VARIABLES, ...PROBE_SETTINGS });
  const cwd = probeWorkFolder();
  try {
    makePrivateDirSync(cwd);
    if (login.machineOwn) makePrivateDirSync(ownClaudeProbeFolder());
  } catch {
    return probeFailure(null, "other", "The usage probe could not create its folder in the kurmis data folder.");
  }
  const replies = new PendingReplies();
  const claude = startFrameProcess(program.command, [...program.args, ...CLAUDE_PROBE_ARGS], {
    env,
    cwd,
    timeoutMs,
    signal: options.signal,
    onFrame: (frame) => {
      const reply = controlReply(frame);
      if (reply !== null) replies.settle(reply.id, reply.reply);
    }
  });
  const result = await converse(claude, replies, login.id, timeoutMs, now, options.previous ?? null);
  const exit = await claude.close(PROBE_CLOSE_GRACE_MS);
  if (!result.ok && exit.end === "aborted") return abortedProbe(result.signedIn);
  return result;
}
async function converse(claude, replies, id, timeoutMs, now, previous) {
  const ask = (requestId, request2) => {
    const reply = replies.wait(requestId);
    claude.send({ type: "control_request", request_id: requestId, request: request2 });
    return replyOrExit(reply, claude.exited);
  };
  const init = await ask("kurmis_1", { subtype: "initialize" });
  if (init.kind === "ended") return failureForExit("claude", init.exit, timeoutMs, null);
  if (!init.value.ok) return probeFailure(null, "upstream_error", "claude answered the start of the usage probe with an error.");
  const planAtStart = initializePlan(init.value.response);
  const usage = await ask("kurmis_2", { subtype: "get_usage", skip_behaviors: true });
  if (usage.kind === "ended") return failureForExit("claude", usage.exit, timeoutMs, planAtStart);
  if (!usage.value.ok) return probeFailure(planAtStart, "upstream_error", "Claude answered the usage request with an error.");
  const answer2 = usage.value.response;
  if (!isRecord(answer2)) return probeFailure(planAtStart, "invalid", "Claude's answer to the usage request could not be read.");
  const available = answer2.rate_limits_available === true;
  const signedIn = available || typeof answer2.subscription_type === "string" && answer2.subscription_type !== "";
  if (available && !isRecord(answer2.rate_limits)) {
    return probeFailure(true, "upstream_error", "Claude could not fetch the plan usage from Anthropic.");
  }
  return { ok: true, signedIn, usage: usageFromGetUsage(id, answer2, now(), previous) };
}
function initializePlan(response) {
  if (!isRecord(response) || !isRecord(response.account)) return null;
  const plan = response.account.subscriptionType;
  return typeof plan === "string" && plan !== "";
}
function controlReply(frame) {
  if (!isRecord(frame) || frame.type !== "control_response" || !isRecord(frame.response)) return null;
  const response = frame.response;
  if (typeof response.request_id !== "string") return null;
  if (response.subtype === "success") return { id: response.request_id, reply: { ok: true, response: response.response } };
  return { id: response.request_id, reply: { ok: false } };
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/core/codex-account.ts
function isObject2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function parseCodexAccountRead(result) {
  if (!isObject2(result)) return null;
  const requiresOpenaiAuth = typeof result["requiresOpenaiAuth"] === "boolean" ? result["requiresOpenaiAuth"] : null;
  const account = result["account"];
  if (account === null || account === void 0) return { signIn: null, requiresOpenaiAuth };
  if (!isObject2(account) || typeof account["type"] !== "string") return null;
  const type = account["type"];
  let signIn2;
  if (type === "chatgpt") signIn2 = { type, planType: text(account["planType"]), email: text(account["email"]) };
  else if (type === "apiKey") signIn2 = { type };
  else signIn2 = { type: "other", name: type };
  return { signIn: signIn2, requiresOpenaiAuth };
}
function codexLoginStatus(read) {
  const signIn2 = read.signIn;
  if (signIn2?.type === "chatgpt") return { loggedIn: true, subscriptionType: signIn2.planType, email: signIn2.email };
  if (signIn2?.type === "apiKey") return { loggedIn: false, subscriptionType: "api key", email: null };
  return { loggedIn: false, subscriptionType: null, email: null };
}

// src/daemon/codex-probe.ts
var CODEX_PROBE_TIMEOUT_MS = 3e4;
var CODEX_PROBE_ARGS = ["app-server"];
async function probeCodexUsage(login, options) {
  return await runProbe(login, options, false);
}
async function readCodexEmail(login, options) {
  const result = await runProbe(login, options, true);
  return result.ok ? result.email ?? null : null;
}
async function runProbe(login, options, accountOnly) {
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? CODEX_PROBE_TIMEOUT_MS;
  if (options.signal?.aborted === true) return abortedProbe(null);
  let program;
  try {
    program = findProgram("codex", { env: options.env });
  } catch (error) {
    if (error instanceof ProgramNotFoundError) {
      return probeFailure(null, "missing", programMissingText("codex"));
    }
    return probeFailure(null, "other", "The codex program could not be looked up.");
  }
  const env = applyEnvPatch(options.env, codexLoginEnv(login, options.env));
  const cwd = probeWorkFolder();
  try {
    makePrivateDirSync(cwd);
  } catch {
    return probeFailure(null, "other", "The usage probe could not create its folder in the kurmis data folder.");
  }
  const replies = new PendingReplies();
  const codex = startFrameProcess(program.command, [...program.args, ...CODEX_PROBE_ARGS], {
    env,
    cwd,
    timeoutMs,
    signal: options.signal,
    onFrame: (frame) => {
      const reply = rpcReply(frame);
      if (reply !== null) replies.settle(reply.id, reply.reply);
    }
  });
  const result = await converse2(codex, replies, login.id, timeoutMs, now, accountOnly);
  const exit = await codex.close(PROBE_CLOSE_GRACE_MS);
  if (!result.ok && exit.end === "aborted") return abortedProbe(result.signedIn);
  return result;
}
async function converse2(codex, replies, id, timeoutMs, now, accountOnly) {
  let nextId = 1;
  const ask = (method, params) => {
    const requestId = nextId++;
    const reply = replies.wait(String(requestId));
    codex.send(params === void 0 ? { id: requestId, method } : { id: requestId, method, params });
    return replyOrExit(reply, codex.exited);
  };
  const init = await ask("initialize", {
    clientInfo: { name: "kurmis", title: "kurmis", version: kurmisVersion },
    capabilities: { experimentalApi: true }
  });
  if (init.kind === "ended") return failureForExit("codex", init.exit, timeoutMs, null);
  if (!init.value.ok) return probeFailure(null, "upstream_error", "codex app-server refused the start of the usage probe.");
  codex.send({ method: "initialized" });
  const account = await ask("account/read", {});
  if (account.kind === "ended") return failureForExit("codex", account.exit, timeoutMs, null);
  if (!account.value.ok) return probeFailure(null, "upstream_error", "codex app-server answered the sign-in question with an error.");
  const read = parseCodexAccountRead(account.value.result);
  if (read === null) return probeFailure(null, "invalid", "codex app-server's answer about the sign-in could not be read.");
  const status2 = codexLoginStatus(read);
  if (!status2.loggedIn) {
    return { ok: true, signedIn: false, usage: { ...emptyCodexUsage(id, now()), subscriptionType: status2.subscriptionType }, email: null };
  }
  if (accountOnly) {
    return { ok: true, signedIn: true, usage: { ...emptyCodexUsage(id, now()), subscriptionType: status2.subscriptionType }, email: status2.email };
  }
  const limits = await ask("account/rateLimits/read");
  if (limits.kind === "ended") return failureForExit("codex", limits.exit, timeoutMs, true);
  if (!limits.value.ok) return probeFailure(true, "upstream_error", "Codex could not read the plan usage from OpenAI.");
  const usage = codexUsageFromResult(id, limits.value.result, now());
  if (usage === null) return probeFailure(true, "invalid", "codex app-server's answer about the plan usage could not be read.");
  return { ok: true, signedIn: true, usage: withPlan(usage, status2.subscriptionType), email: status2.email };
}
function withPlan(usage, plan) {
  return usage.subscriptionType === null && plan !== null ? { ...usage, subscriptionType: plan } : usage;
}
function rpcReply(frame) {
  if (!isRecord2(frame) || !("id" in frame) || "method" in frame) return null;
  const id = frame.id;
  if (typeof id !== "number" && typeof id !== "string") return null;
  if ("result" in frame) return { id: String(id), reply: { ok: true, result: frame.result } };
  return { id: String(id), reply: { ok: false } };
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/daemon/control.ts
var DISCARD_BODY_MS = 3e4;
function createControl(options) {
  const { table, tokens, identity, poller, log, now } = options;
  async function status2() {
    table.checkConfig();
    await tokens.prime(table.claudeLogins().map((login) => login.id));
    const rows = table.routeRows(table.ownLogin("claude").id, false);
    const at2 = now();
    const logins = table.logins().map((login) => {
      const row = rows.find((each) => each.id === login.id);
      const cooldown = table.cooldown(login.id, at2);
      return {
        id: login.id,
        provider: login.provider,
        alias: login.alias,
        machineOwn: login.machineOwn,
        routing: login.routing,
        fiveHourLimit: login.fiveHourLimit,
        weeklyLimit: login.weeklyLimit,
        useFirst: login.useFirst,
        signedIn: login.provider === "claude" ? table.claudeSignedIn(login.id) : table.probedSignedIn(login.id),
        usage: table.usage(login.id),
        cooldownUntil: cooldown === null ? null : Number.isFinite(cooldown) ? cooldown : "unknown",
        block: row === void 0 ? null : routeBlock(row, at2),
        sessions: login.provider === "claude" ? table.sessionCount(login.id) : 0,
        email: login.provider === "claude" ? identity.read(login)?.email ?? null : table.codexEmail(login.id),
        probing: poller.isRunning(login.id)
      };
    });
    return {
      ok: true,
      apiVersion: CONTROL_API_VERSION,
      version: kurmisVersion,
      pid: options.pid,
      port: options.port,
      startedAt: options.startedAt,
      logins
    };
  }
  async function handle(req, res, path) {
    const key = req.headers[KEY_HEADER];
    if (!routeKeyMatches(typeof key === "string" ? key : null, options.key)) {
      log.write("control_rejected", { reason: "bad_secret", method: methodOf(req.method) });
      req.resume();
      res.writeHead(403).end();
      return;
    }
    log.write("control_request", { method: methodOf(req.method) });
    try {
      switch (path) {
        case CONTROL_PATHS.status:
          if (!allow(req, res, "GET")) return;
          req.resume();
          answer(res, 200, await status2());
          return;
        case CONTROL_PATHS.probe: {
          if (!allow(req, res, "POST")) return;
          const asked = await readProbeRequest(req);
          if (asked === TOO_LARGE) {
            refuseTooLarge(req, res);
            return;
          }
          if (typeof asked === "string") {
            answer(res, 400, failure(asked));
            return;
          }
          const unknown = asked.logins?.filter((id) => table.find(id) === void 0) ?? [];
          if (unknown.length > 0) {
            answer(res, 400, failure(`There is no login ${unknown.join(", ")}.`));
            return;
          }
          await poller.probeMany(asked.logins ?? poller.pollable(), "request");
          answer(res, 200, await status2());
          return;
        }
        case CONTROL_PATHS.reload: {
          if (!allow(req, res, "POST")) return;
          req.resume();
          const result = table.reloadConfig();
          if (!result.ok) {
            answer(res, 500, failure(result.error));
            return;
          }
          const fresh = table.logins().filter((login) => table.probedSignedIn(login.id) === null).map((login) => login.id);
          if (fresh.length > 0) void poller.probeMany(fresh, "config");
          answer(res, 200, ok());
          return;
        }
        case CONTROL_PATHS.stop: {
          if (!allow(req, res, "POST")) return;
          const asked = await readStopRequest(req);
          if (asked === TOO_LARGE) {
            refuseTooLarge(req, res);
            return;
          }
          if (typeof asked === "string") {
            answer(res, 400, failure(asked));
            return;
          }
          res.once("finish", () => {
            options.onStopRequested(asked);
          });
          answer(res, 200, ok());
          return;
        }
        default:
          req.resume();
          answer(res, 404, failure(`The daemon has no control path ${path}.`));
      }
    } catch {
      log.write("internal_error", { method: methodOf(req.method) });
      if (!res.headersSent) answer(res, 500, failure("The daemon failed to answer the control request."));
      else res.destroy();
    }
  }
  return { handle, status: status2 };
}
function allow(req, res, method) {
  if (req.method === method) return true;
  req.resume();
  res.setHeader("allow", method);
  answer(res, 405, failure(`This control path takes ${method}.`));
  return false;
}
function answer(res, status2, body) {
  res.writeHead(status2, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(body));
}
function ok() {
  return { ok: true };
}
function failure(error) {
  return { ok: false, error };
}
var TOO_LARGE = /* @__PURE__ */ Symbol("too large");
function readBody(req) {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > MAX_CONTROL_BODY_BYTES) return Promise.resolve(TOO_LARGE);
  return new Promise((resolve8, reject) => {
    const chunks = [];
    let size = 0;
    const stopListening = () => {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
    };
    const onData = (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > MAX_CONTROL_BODY_BYTES) {
        stopListening();
        resolve8(TOO_LARGE);
        return;
      }
      chunks.push(bytes);
    };
    const onEnd = () => {
      stopListening();
      resolve8(Buffer.concat(chunks).toString("utf8"));
    };
    const onError = (error) => {
      stopListening();
      reject(error);
    };
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
  });
}
function refuseTooLarge(req, res) {
  answer(res, 413, failure(`The control request's body is larger than ${String(MAX_CONTROL_BODY_BYTES / 1024)} KB.`));
  if (req.complete) return;
  const timer = setTimeout(() => {
    req.socket.destroy();
  }, DISCARD_BODY_MS);
  timer.unref();
  const done = () => {
    clearTimeout(timer);
  };
  req.once("end", done);
  req.once("close", done);
  req.resume();
}
async function readJsonObject(req, what) {
  const body = await readBody(req);
  if (body === TOO_LARGE) return TOO_LARGE;
  const text2 = body.trim();
  if (text2.length === 0) return {};
  let value;
  try {
    value = JSON.parse(text2);
  } catch {
    return `The ${what} is not JSON.`;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return `The ${what} must be a JSON object.`;
  return value;
}
async function readStopRequest(req) {
  const value = await readJsonObject(req, "stop request");
  if (typeof value !== "object") return value;
  const maxWaitMs = value.maxWaitMs;
  if (maxWaitMs === void 0) return {};
  if (typeof maxWaitMs !== "number" || !Number.isFinite(maxWaitMs) || maxWaitMs < 0) {
    return '"maxWaitMs" must be a number of milliseconds, 0 or more.';
  }
  return { maxWaitMs };
}
async function readProbeRequest(req) {
  const value = await readJsonObject(req, "probe request");
  if (typeof value !== "object") return value;
  const logins = value.logins;
  if (logins === void 0) return {};
  if (!Array.isArray(logins) || !logins.every((id) => typeof id === "string")) return '"logins" must be a list of login ids.';
  return { logins };
}

// src/data/state.ts
var STATE_VERSION = 1;
var SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1e3;
var MAX_SESSIONS = 2e3;
var SESSION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
function isSessionId(value) {
  return typeof value === "string" && SESSION_ID_PATTERN.test(value);
}
function emptyState() {
  return { usage: /* @__PURE__ */ new Map(), cooldowns: /* @__PURE__ */ new Map(), sessions: /* @__PURE__ */ new Map() };
}
function isTime(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function isWindow(value) {
  return isPlainObject(value) && typeof value.utilization === "number" && Number.isFinite(value.utilization) && (value.resetsAt === null || typeof value.resetsAt === "string");
}
function isWindowOrNull(value) {
  return value === null || isWindow(value);
}
function isStringOrNull(value) {
  return value === null || typeof value === "string";
}
function isStoredUsage(value, login) {
  if (!isPlainObject(value)) return false;
  return value.accountId === login && isLoginProvider(value.provider) && isTime(value.fetchedAt) && (value.source === "probe" || value.source === "session") && isStringOrNull(value.subscriptionType) && typeof value.rateLimitsAvailable === "boolean" && isWindowOrNull(value.fiveHour) && isWindowOrNull(value.sevenDay) && isWindowOrNull(value.sevenDayOverage) && isWindowOrNull(value.sevenDayOpus) && isWindowOrNull(value.sevenDaySonnet) && Array.isArray(value.modelScoped) && value.modelScoped.every((window) => isWindow(window) && typeof window.displayName === "string") && (value.windows === void 0 || Array.isArray(value.windows) && value.windows.every(isWindow)) && (value.extraUsage === null || isPlainObject(value.extraUsage)) && (value.status === null || value.status === "allowed" || value.status === "allowed_warning" || value.status === "rejected") && (value.limited === null || isPlainObject(value.limited)) && isStringOrNull(value.error);
}
function parseState(value, now) {
  const state = emptyState();
  if (!isPlainObject(value)) return { state, dropped: 0, problem: "corrupt" };
  if (value.version !== STATE_VERSION) return { state, dropped: 0, problem: "wrong-version" };
  let dropped = 0;
  const entries = (field) => {
    if (field === void 0) return [];
    if (!isPlainObject(field)) {
      dropped++;
      return [];
    }
    return Object.entries(field);
  };
  for (const [key, usage] of entries(value.usage)) {
    if (isLoginId(key) && isStoredUsage(usage, key)) state.usage.set(key, usage);
    else dropped++;
  }
  for (const [key, until] of entries(value.cooldowns)) {
    if (!isLoginId(key) || until !== null && !isTime(until)) dropped++;
    else state.cooldowns.set(key, until === null ? Infinity : until);
  }
  for (const [key, placement] of entries(value.sessions)) {
    if (isSessionId(key) && isPlainObject(placement) && isLoginId(placement.login) && isTime(placement.lastUsed)) {
      state.sessions.set(key, { login: placement.login, lastUsed: placement.lastUsed });
    } else {
      dropped++;
    }
  }
  pruneState(state, now);
  return { state, dropped, problem: null };
}
function pruneState(state, now, maxAgeMs = SESSION_MAX_AGE_MS, maxSessions = MAX_SESSIONS) {
  for (const [login, until] of state.cooldowns) if (until <= now) state.cooldowns.delete(login);
  for (const [session, placement] of state.sessions) {
    if (now - placement.lastUsed > maxAgeMs) state.sessions.delete(session);
  }
  if (state.sessions.size > maxSessions) {
    const newestFirst = [...state.sessions].sort((a, b) => b[1].lastUsed - a[1].lastUsed);
    state.sessions = new Map(newestFirst.slice(0, maxSessions));
  }
}
function serializeState(state) {
  const usage = {};
  for (const [login, snapshot] of state.usage) usage[login] = snapshot;
  const cooldowns = {};
  for (const [login, until] of state.cooldowns) cooldowns[login] = Number.isFinite(until) ? until : null;
  const sessions = /* @__PURE__ */ Object.create(null);
  for (const [session, placement] of state.sessions) sessions[session] = placement;
  return { version: STATE_VERSION, usage, cooldowns, sessions };
}
function loadState(now = Date.now(), path = statePath()) {
  let read;
  try {
    read = readJsonFileSync(path);
  } catch {
    return { state: emptyState(), dropped: 0, problem: "corrupt" };
  }
  if (read.status === "missing") return { state: emptyState(), dropped: 0, problem: "missing" };
  if (read.status === "corrupt") return { state: emptyState(), dropped: 0, problem: "corrupt" };
  return parseState(read.value, now);
}
async function saveState(state, path = statePath()) {
  await writeJsonFile(path, serializeState(state));
}
function createCoalescedWriter(write, options) {
  let dirty = false;
  let timer = null;
  let inFlight = null;
  let lastStart = -Infinity;
  const run2 = () => {
    timer = null;
    if (!dirty || inFlight !== null) return inFlight ?? Promise.resolve();
    dirty = false;
    lastStart = Date.now();
    const started = write().catch((error) => options.onError?.(error)).finally(() => {
      inFlight = null;
      if (dirty) arm();
    });
    inFlight = started;
    return started;
  };
  const arm = () => {
    if (timer !== null || inFlight !== null) return;
    const wait = Math.max(0, lastStart + options.minIntervalMs - Date.now());
    timer = setTimeout(() => void run2(), wait);
    timer.unref?.();
  };
  return {
    schedule() {
      dirty = true;
      arm();
    },
    async flush() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (inFlight !== null) await inFlight;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (dirty) await run2();
    },
    pending() {
      return dirty || inFlight !== null;
    }
  };
}

// src/daemon/logins.ts
var NO_SESSION_KEY = ":no-session";
var CONFIG_CHECK_MS = 2e3;
var STATE_WRITE_MS = 2e3;
var CONFIG_LOCK_TIMEOUT_MS = 500;
var LoginTable = class {
  constructor(options) {
    this.options = options;
    this.writer = createCoalescedWriter(async () => {
      pruneState(this.state, this.options.now());
      await saveState(this.state, this.stateFile);
    }, {
      minIntervalMs: options.stateWriteMs ?? STATE_WRITE_MS,
      onError: (error) => {
        this.options.log.write("state_write_failed", { code: errorCodeOf(error) });
      }
    });
  }
  options;
  config = defaultConfig();
  stamp = null;
  lastCheck = -Infinity;
  state = emptyState();
  /** What the last probe of each login said about its sign-in. Absent: not probed yet. */
  signedIn = /* @__PURE__ */ new Map();
  /**
   * The email the last successful probe of each Codex login named, null when it named none.
   * In memory only, for the status answer: it is never logged or written to a file.
   */
  codexEmails = /* @__PURE__ */ new Map();
  /**
   * Sessions held to one login after a 400 on the login they had just moved to
   * (`replayDecision`'s `pin-back`). The proxy lets go of a hold when the held login cannot
   * serve (`releaseSession`). In memory only: `state.json` has no field for it, and a daemon
   * restart lets such a session be placed again. Kept within the same bounds as the session
   * placements (`pruneHolds`).
   */
  held = /* @__PURE__ */ new Map();
  /**
   * Logins whose token Anthropic refused with a 401 on a request of a CLI that was started on
   * another login, after the one renewal the proxy tries (`markRefused`), with when that was.
   * Routing treats them as signed out until a probe of the login that started later succeeds.
   * In memory only.
   */
  refused = /* @__PURE__ */ new Map();
  /**
   * The rate-limit headers of the last answer of each login (`noteObservation`). A probe that
   * started before they arrived measured an older state, so they are applied again on top of
   * its snapshot (`setProbeUsage`). In memory only; they hold no token or body.
   */
  observations = /* @__PURE__ */ new Map();
  /** When each login's current cooldown was set; absent for one read from `state.json`. In memory only. */
  cooldownSetAt = /* @__PURE__ */ new Map();
  listeners = /* @__PURE__ */ new Set();
  writer;
  /** The files, fixed when the table is made, so a later change of `KURMIS_HOME` cannot move them. */
  configFile = configPath();
  stateFile = statePath();
  /** Reads `config.json` and `state.json`. A config that does not read leaves the defaults. */
  load() {
    this.reloadConfig();
    const read = loadState(this.options.now(), this.stateFile);
    this.state = read.state;
    this.options.log.write("state_loaded", {
      count: read.state.sessions.size,
      ...read.problem === "corrupt" ? { reason: "corrupt" } : read.problem === "wrong-version" ? { reason: "wrong_version" } : {},
      ...read.dropped > 0 ? { attempt: read.dropped } : {}
    });
  }
  /**
   * Reads `config.json` again. A file that does not read keeps the config the daemon has, so a
   * half-finished edit never empties the pool; the error says why, for the control API.
   */
  reloadConfig() {
    this.lastCheck = this.options.now();
    let stamp;
    try {
      stamp = configStamp(this.configFile);
    } catch (error) {
      this.options.log.write("config_invalid", { code: errorCodeOf(error) });
      return { ok: false, error: `${this.configFile} could not be read: ${messageOf3(error)}` };
    }
    if (stamp === this.stamp) return { ok: true, changed: false };
    try {
      this.config = loadConfig(this.configFile, { timeoutMs: CONFIG_LOCK_TIMEOUT_MS });
    } catch (error) {
      this.stamp = stamp;
      this.options.log.write("config_invalid", { reason: "invalid" });
      return { ok: false, error: messageOf3(error) };
    }
    this.stamp = stamp;
    const ids = new Set(this.config.logins.map((login) => login.id));
    for (const id of [...this.state.usage.keys()]) if (!ids.has(id)) this.state.usage.delete(id);
    for (const id of [...this.state.cooldowns.keys()]) if (!ids.has(id)) this.state.cooldowns.delete(id);
    for (const id of [...this.signedIn.keys()]) if (!ids.has(id)) this.signedIn.delete(id);
    for (const id of [...this.codexEmails.keys()]) if (!ids.has(id)) this.codexEmails.delete(id);
    for (const id of [...this.refused.keys()]) if (!ids.has(id)) this.refused.delete(id);
    for (const id of [...this.observations.keys()]) if (!ids.has(id)) this.observations.delete(id);
    for (const id of [...this.cooldownSetAt.keys()]) if (!ids.has(id)) this.cooldownSetAt.delete(id);
    this.options.log.write("config_loaded", { count: this.config.logins.length });
    this.changed();
    return { ok: true, changed: true };
  }
  /** Reloads the config when its contents changed, looking at most every `configCheckMs`. */
  checkConfig() {
    if (this.options.now() - this.lastCheck < (this.options.configCheckMs ?? CONFIG_CHECK_MS)) return;
    this.reloadConfig();
  }
  /** Every login in `config.json`, the logins of plain claude and plain codex first. */
  logins() {
    return this.config.logins;
  }
  claudeLogins() {
    return this.config.logins.filter((login) => login.provider === "claude");
  }
  find(id) {
    return findLogin(this.config, id);
  }
  /**
   * The login a plain `claude` or a plain `codex` uses: the one that CLI is signed in
   * to. The config always has one for each provider.
   */
  ownLogin(provider) {
    return machineOwnLogin(this.config, provider);
  }
  port() {
    return this.config.port;
  }
  /**
   * The routing rows of the Claude logins, for one request.
   *
   * `startedOn` is the login the request's CLI was started on, and `callerSigns` whether the
   * request carries an `authorization` header of its own. Null `startedOn` says the CLI's own
   * credentials are no kurmis login's (`STARTED_ON_NONE`): no login is signed with its header,
   * and plain claude's login, whose token belongs to another account than the CLI's,
   * is left out of the request's pool (`loggedIn` and `credentialsReadable` false). The proxy forwards that
   * header for the started-on login when it holds no token for it, so such a login counts as
   * signed in and signable. Every other login is signable only with a token the daemon read.
   *
   * A login whose token Anthropic refused (`markRefused`) counts as signed out, except the
   * started-on login and `pinned`, the login the request names with `x-kurmis-login`: their
   * requests go to it and get its 401 as it is.
   */
  routeRows(startedOn, callerSigns, pinned = null) {
    const now = this.options.now();
    return this.claudeLogins().map((login) => {
      const notTheCli = startedOn === null && login.machineOwn;
      const token = notTheCli ? null : this.options.tokens.read(login.id);
      const passThrough = token === null && callerSigns && login.id === startedOn;
      const refused = this.refused.has(login.id) && login.id !== startedOn && login.id !== pinned;
      return {
        id: login.id,
        loggedIn: !notTheCli && !refused && (token !== null || passThrough || this.signedIn.get(login.id) === true),
        credentialsReadable: token !== null || passThrough,
        tokenExpiresAt: token?.expiresAt ?? null,
        usage: this.usage(login.id),
        autoRoute: login.routing,
        fiveHourLimitPercent: login.fiveHourLimit,
        weeklyLimitPercent: login.weeklyLimit,
        useFirst: login.useFirst,
        cooldownUntil: this.cooldown(login.id, now)
      };
    });
  }
  usage(id) {
    return this.state.usage.get(id) ?? null;
  }
  setUsage(id, usage) {
    if (!isLoginId(id)) return;
    this.state.usage.set(id, usage);
    this.save();
    this.changed();
  }
  /**
   * Folds the rate-limit headers of one of the login's answers into its usage, and keeps them
   * for `setProbeUsage`. Headers that say nothing about usage change nothing.
   */
  noteObservation(id, observation) {
    if (observation.status === null && observation.representativeClaim === null && Object.keys(observation.windows).length === 0) return;
    if (!isLoginId(id)) return;
    this.observations.set(id, observation);
    this.setUsage(id, usageFromUnifiedHeaders(id, this.usage(id), observation));
  }
  /**
   * Stores a successful probe's snapshot. A probe that started at `startedAt` measured the login
   * at that time or a little later, so when an answer's rate-limit headers arrived after it
   * started, they count as newer and are
   * applied again on top of the probe's snapshot: the probe fills in what the headers do not
   * carry, and does not undo what they said.
   */
  setProbeUsage(id, usage, startedAt) {
    const observation = this.observations.get(id);
    this.setUsage(id, observation !== void 0 && observation.observedAt > startedAt ? usageFromUnifiedHeaders(id, usage, observation) : usage);
  }
  /** Until when routing skips the login: ms since epoch, `Infinity` for an unknown end, null for none. */
  cooldown(id, now = this.options.now()) {
    const until = this.state.cooldowns.get(id);
    return until === void 0 || until <= now ? null : until;
  }
  setCooldown(id, until) {
    if (!isLoginId(id)) return;
    if (until === null) {
      this.state.cooldowns.delete(id);
      this.cooldownSetAt.delete(id);
    } else {
      this.state.cooldowns.set(id, until);
      this.cooldownSetAt.set(id, this.options.now());
    }
    this.save();
    this.changed();
  }
  /** When the login's cooldown was set by this daemon, or null (none, or one read from `state.json`). */
  cooldownSince(id) {
    return this.cooldownSetAt.get(id) ?? null;
  }
  /** Whether the last probe found the login signed in; null before its first probe. */
  probedSignedIn(id) {
    return this.signedIn.get(id) ?? null;
  }
  setSignedIn(id, value) {
    if (this.signedIn.get(id) === value) return;
    this.signedIn.set(id, value);
    this.changed();
  }
  /** The email the last successful probe of a Codex login named, or null. In memory only. */
  codexEmail(id) {
    return this.codexEmails.get(id) ?? null;
  }
  /** Keeps what a successful probe of a Codex login said its email is (null: none). */
  setCodexEmail(id, email) {
    if (this.find(id)?.provider !== "codex") return;
    this.codexEmails.set(id, email);
  }
  /**
   * Gives the login the automatic alias its email makes (`followEmail` in `config.ts`) when its
   * alias is automatic and does not fit the email yet, by writing `config.json` and reading it
   * again. The change is worked out again inside the lock, from the file as it is then. When the
   * lock is not free within `CONFIG_LOCK_TIMEOUT_MS`, or the write fails, the failure is logged
   * with the login's id only and the config stays as it is; the next probe tries again. The log
   * line never names the alias or the email.
   */
  noteEmail(id, email) {
    this.checkConfig();
    const login = this.find(id);
    if (login === void 0 || followEmail(this.config, id, email) === this.config) return;
    try {
      changeConfig((current) => followEmail(current, id, email), this.configFile, { timeoutMs: CONFIG_LOCK_TIMEOUT_MS });
    } catch (error) {
      this.options.log.write("alias_write_failed", { login: login.id, reason: isLockTimeout(error) ? "timeout" : "error", code: errorCodeOf(error) });
      return;
    }
    this.reloadConfig();
  }
  /** Records that Anthropic refused the login's token after the proxy tried to renew it (see `refused`). */
  markRefused(id) {
    const known = this.refused.has(id);
    this.refused.set(id, this.options.now());
    if (!known) this.changed();
  }
  /** Whether `markRefused` holds for the login. */
  isRefused(id) {
    return this.refused.has(id);
  }
  /**
   * Ends `markRefused`: a probe of the login succeeded. A probe that started at `probeStartedAt`
   * ends only a refusal from before it or from the same millisecond; a refusal that came while
   * it ran is newer and stays.
   */
  clearRefused(id, probeStartedAt = Infinity) {
    const at2 = this.refused.get(id);
    if (at2 === void 0 || at2 > probeStartedAt) return;
    this.refused.delete(id);
    this.changed();
  }
  /**
   * Whether a Claude login has credentials here: a token read, or a probe that found it
   * signed in. Null when neither has said yet.
   */
  claudeSignedIn(id) {
    if (this.options.tokens.read(id) !== null) return true;
    return this.probedSignedIn(id);
  }
  /** The login that served the session's last accepted answer, or null. */
  sessionLogin(key) {
    return this.state.sessions.get(key)?.login ?? null;
  }
  /** Records that `id` served the session's request, after the answer was accepted. */
  placeSession(key, id) {
    if (!isSessionId(key) || !isLoginId(id)) return { kind: "same" };
    const previous = this.state.sessions.get(key)?.login;
    this.state.sessions.set(key, { login: id, lastUsed: this.options.now() });
    this.save();
    if (previous === void 0) return { kind: "placed" };
    return previous === id ? { kind: "same" } : { kind: "moved", from: previous };
  }
  /** How many sessions' last request this login served. */
  sessionCount(id) {
    let count = 0;
    for (const placement of this.state.sessions.values()) if (placement.login === id) count++;
    return count;
  }
  /**
   * The login a session is held to after a pin-back, or null. A hold unused for
   * `SESSION_MAX_AGE_MS` has ended, even when no new hold has pruned it yet.
   */
  heldLogin(key) {
    const hold = this.held.get(key);
    if (hold === void 0) return null;
    const now = this.options.now();
    if (hold.lastUsed < now - SESSION_MAX_AGE_MS) {
      this.held.delete(key);
      return null;
    }
    hold.lastUsed = now;
    return hold.login;
  }
  holdSession(key, id) {
    if (!isLoginId(id)) return;
    this.held.delete(key);
    this.held.set(key, { login: id, lastUsed: this.options.now() });
    this.pruneHolds();
  }
  /** How many sessions are held after a pin-back. */
  heldCount() {
    return this.held.size;
  }
  /** Ends a session's hold, so its requests are routed on Auto again. */
  releaseSession(key) {
    this.held.delete(key);
  }
  /** Calls `listener` after every change of a login's usage, cooldown, sign-in or settings. */
  onChange(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  changed() {
    for (const listener of [...this.listeners]) listener();
  }
  /** Writes `state.json` now if a change is waiting, and waits for it. */
  flush() {
    return this.writer.flush();
  }
  save() {
    this.writer.schedule();
  }
  /**
   * Drops holds unused for `SESSION_MAX_AGE_MS`, and beyond the `MAX_SESSIONS` most recently
   * used, the same bounds `state.json` keeps session placements in.
   */
  pruneHolds() {
    const oldest = this.options.now() - SESSION_MAX_AGE_MS;
    for (const [key, hold] of this.held) if (hold.lastUsed < oldest) this.held.delete(key);
    if (this.held.size <= MAX_SESSIONS) return;
    const byUse = [...this.held].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [key] of byUse.slice(0, this.held.size - MAX_SESSIONS)) this.held.delete(key);
  }
};
function isLockTimeout(error) {
  return error instanceof Error && error.cause instanceof LockTimeoutError;
}
function messageOf3(error) {
  return error instanceof Error ? error.message : String(error);
}

// src/core/capacity-hold.ts
var CAPACITY_HOLD_MS = 12e4;
var CAPACITY_HOLD_BASE_MS = 5e3;
var CAPACITY_HOLD_MAX_MS = 3e4;
var CAPACITY_STREAK_MS = 10 * 6e4;
function capacityRefusal(status2, usageLimit) {
  if (status2 === 529) return "529 Overloaded";
  if (status2 === 429 && !usageLimit) return "429 Too Many Requests";
  return null;
}
function retryAfterMs(value) {
  if (value == null || value.trim().length === 0) return null;
  const seconds3 = Number(value);
  if (Number.isFinite(seconds3) && seconds3 >= 0) return seconds3 * 1e3;
  return null;
}
function capacityHoldDelayMs(attempt, asked, random, baseMs = CAPACITY_HOLD_BASE_MS, maxMs = CAPACITY_HOLD_MAX_MS) {
  const step = Math.min(Math.max(baseMs, maxMs), baseMs * 2 ** Math.max(0, attempt - 1));
  const fraction = Number.isFinite(random) ? Math.max(0, Math.min(1, random)) : 0;
  return Math.max(asked ?? 0, Math.round(step + step / 2 * fraction));
}
function capacityHoldAnswer(reason, heldMs) {
  const message = `Anthropic's API had no capacity for this request (${reason}) for ${String(Math.round(heldMs / 1e3))} s. The kurmis proxy holds it again when it is sent again.`;
  return {
    status: 529,
    headers: { "content-type": "application/json", "retry-after": "1" },
    body: JSON.stringify({ type: "error", error: { type: "overloaded_error", message } })
  };
}
var CapacityCooling = class {
  constructor(options = {}) {
    this.options = options;
  }
  options;
  streaks = /* @__PURE__ */ new Map();
  cooling = /* @__PURE__ */ new Map();
  /**
   * Records that `loginId` answered a request of the session without capacity. `reason` is
   * what `capacityRefusal` said, `retryAfter` the answer's `retry-after` header, and `random`
   * a 0-1 number for the jitter.
   */
  noteNoCapacity(sessionId, loginId, reason, retryAfter, random, now) {
    this.dropExpired(now);
    const attempt = (this.streaks.get(sessionId)?.attempt ?? 0) + 1;
    this.streaks.set(sessionId, { attempt, at: now });
    const delayMs = capacityHoldDelayMs(
      attempt,
      retryAfterMs(retryAfter),
      random,
      this.options.baseMs ?? CAPACITY_HOLD_BASE_MS,
      this.options.maxMs ?? CAPACITY_HOLD_MAX_MS
    );
    const entry = this.cooling.get(sessionId) ?? { logins: /* @__PURE__ */ new Map(), reason };
    entry.reason = reason;
    const until = Math.max(entry.logins.get(loginId) ?? 0, now + delayMs);
    entry.logins.set(loginId, until);
    this.cooling.set(sessionId, entry);
    return { attempt, delayMs, until };
  }
  /** The session got an answer that was not a want of capacity, so its count in a row starts over. */
  noteAnswered(sessionId) {
    this.streaks.delete(sessionId);
  }
  /** The session's count of answers without capacity in a row, or 1 when it has none. */
  attempt(sessionId, now) {
    this.dropExpired(now);
    return this.streaks.get(sessionId)?.attempt ?? 1;
  }
  /**
   * The session's logins that are still cooling, each with the time it may be tried again, and
   * what the last answer without capacity was. Null when none is cooling, which is when a new
   * request of the session needs no hold from the start.
   */
  coolingOf(sessionId, now) {
    this.dropExpired(now);
    return this.cooling.get(sessionId) ?? null;
  }
  /** Whether this login is cooling for the session now. */
  isCooling(sessionId, loginId, now) {
    return (this.coolingOf(sessionId, now)?.logins.get(loginId) ?? 0) > now;
  }
  /**
   * What a held request of the session waits for. `usable` is the logins the session may use
   * now (`accountsInScope`): a login that has left the session's pool is no reason to wait.
   * `cooling` is the usable logins still cooling, which the next choice of a login must pass
   * over, and `wakeAt` is when the first of them may be tried again, or null when none is
   * cooling. A held request that finds no login and nothing cooling is answered with the pool's
   * own refusal, because then it is a usage limit or a sign-in problem, not a want of capacity.
   */
  waitFor(sessionId, usable, now) {
    const cooling = /* @__PURE__ */ new Set();
    let wakeAt = null;
    for (const [id, until] of this.coolingOf(sessionId, now)?.logins ?? []) {
      if (until <= now || !usable.has(id)) continue;
      cooling.add(id);
      wakeAt = wakeAt === null ? until : Math.min(wakeAt, until);
    }
    return { cooling, wakeAt };
  }
  /** Forgets a session, as when the daemon drops its route. */
  forget(sessionId) {
    this.streaks.delete(sessionId);
    this.cooling.delete(sessionId);
  }
  dropExpired(now) {
    for (const [id, streak] of this.streaks) {
      if (now - streak.at > CAPACITY_STREAK_MS) this.streaks.delete(id);
    }
    for (const [id, entry] of this.cooling) {
      for (const [login, until] of entry.logins) if (until <= now) entry.logins.delete(login);
      if (entry.logins.size === 0) this.cooling.delete(id);
    }
  }
};

// src/daemon/upstream.ts
var import_node_http2 = __toESM(require("node:http"), 1);
var import_node_https = __toESM(require("node:https"), 1);
var import_node_stream = require("node:stream");
var ANTHROPIC_API_URL = "https://api.anthropic.com";
var UPSTREAM_IDLE_TIMEOUT_MS = 20 * 6e4;
var UPSTREAM_CONNECT_TIMEOUT_MS = 3e4;
var KEEPALIVE_PROBE_DELAY_MS = 3e4;
var FREE_SOCKET_TIMEOUT_MS = 3e4;
var RESEND_WINDOW_MS = 2e3;
var DISCARD_LIMIT_BYTES = 1024 * 1024;
var DISCARD_TIMEOUT_MS = 5e3;
var RESET_CODES = /* @__PURE__ */ new Set(["ECONNRESET", "EPIPE"]);
function upstreamOrigin(env) {
  const raw = env["KURMIS_UPSTREAM_URL"];
  if (raw === void 0 || raw === "") return ANTHROPIC_API_URL;
  const problem = "KURMIS_UPSTREAM_URL must be an http or https origin such as http://127.0.0.1:8080";
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${problem}; the value is not a URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`${problem}; the scheme is not http or https`);
  if (url.username !== "" || url.password !== "") throw new Error(`${problem}; the value has credentials in it`);
  if (raw.includes("?") || raw.includes("#")) throw new Error(`${problem}; the value has a query or fragment`);
  if (url.pathname !== "/") throw new Error(`${problem}; the value has a path`);
  return url.origin;
}
var UpstreamError = class extends Error {
  constructor(kind, code, message, options) {
    super(message, options);
    this.kind = kind;
    this.code = code;
    this.name = "UpstreamError";
  }
  kind;
  code;
};
function createUpstream(options) {
  const url = new URL(options.origin);
  const tls = url.protocol === "https:";
  if (!tls && url.protocol !== "http:") throw new Error("the upstream origin must be http or https");
  const hostname = url.hostname.replace(/^\[(.*)\]$/, "$1");
  const port = url.port === "" ? void 0 : Number(url.port);
  const idleTimeoutMs = options.idleTimeoutMs ?? UPSTREAM_IDLE_TIMEOUT_MS;
  const connectTimeoutMs = options.connectTimeoutMs ?? UPSTREAM_CONNECT_TIMEOUT_MS;
  const keepAliveProbeDelayMs = options.keepAliveProbeDelayMs ?? KEEPALIVE_PROBE_DELAY_MS;
  const resendWindowMs = options.resendWindowMs ?? RESEND_WINDOW_MS;
  const agentOptions = {
    keepAlive: true,
    keepAliveMsecs: keepAliveProbeDelayMs,
    // Applies to connections waiting for their next request; a running request sets its own.
    timeout: options.freeSocketTimeoutMs ?? FREE_SOCKET_TIMEOUT_MS,
    scheduling: "lifo"
  };
  const agent = tls ? new import_node_https.default.Agent(agentOptions) : new import_node_http2.default.Agent(agentOptions);
  const transport = tls ? import_node_https.default : import_node_http2.default;
  let closed = false;
  function attempt(request2, retried) {
    return new Promise((resolve8, reject) => {
      const { signal } = request2;
      if (signal.aborted) {
        reject(abortedError());
        return;
      }
      let response = null;
      let answered = false;
      let over = false;
      let connectTimer;
      let writtenAt = null;
      const req = transport.request({
        hostname,
        port,
        method: request2.method,
        path: request2.path,
        headers: request2.headers,
        agent
      });
      const fail4 = (error) => {
        if (over) return;
        clearTimeout(connectTimer);
        response?.destroy(error);
        req.destroy(error);
      };
      const onAbort = () => fail4(abortedError());
      const end = () => {
        over = true;
        clearTimeout(connectTimer);
        signal.removeEventListener("abort", onAbort);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      req.setTimeout(idleTimeoutMs, () => {
        fail4(new UpstreamError("timeout", "ETIMEDOUT", `the Anthropic API connection carried no data for ${String(idleTimeoutMs)} ms`));
      });
      req.on("socket", (socket) => {
        socket.setKeepAlive(true, keepAliveProbeDelayMs);
        if (!socket.connecting) return;
        connectTimer = setTimeout(() => {
          fail4(new UpstreamError("timeout", "ETIMEDOUT", `could not connect to the Anthropic API within ${String(connectTimeoutMs)} ms`));
        }, connectTimeoutMs);
        socket.once(tls ? "secureConnect" : "connect", () => clearTimeout(connectTimer));
      });
      req.once("finish", () => {
        writtenAt = Date.now();
      });
      req.on("error", (error) => {
        if (answered) return;
        answered = true;
        const reusedSocket = req.reusedSocket;
        const soonAfterWriting = writtenAt === null || Date.now() - writtenAt <= resendWindowMs;
        end();
        if (!retried && reusedSocket && soonAfterWriting && !signal.aborted && !closed && !(error instanceof UpstreamError) && RESET_CODES.has(errorCodeOf(error))) {
          resolve8(attempt(request2, true));
          return;
        }
        reject(toUpstreamError(error));
      });
      req.on("response", (res) => {
        if (answered) {
          res.destroy();
          return;
        }
        answered = true;
        response = res;
        let failure2 = null;
        res.on("error", (error) => {
          failure2 ??= toUpstreamError(error);
        });
        res.once("close", end);
        resolve8(answerOf(res, () => failure2));
      });
      req.end(request2.body);
    });
  }
  return {
    send(request2) {
      if (closed) return Promise.reject(new UpstreamError("network", "other", "the upstream client is closed"));
      return attempt(request2, false);
    },
    close() {
      closed = true;
      agent.destroy();
    }
  };
}
function abortedError() {
  return new UpstreamError("aborted", "ABORT_ERR", "the request to the Anthropic API was aborted");
}
function toUpstreamError(error) {
  if (error instanceof UpstreamError) return error;
  const code = errorCodeOf(error);
  return new UpstreamError("network", code, `the request to the Anthropic API failed (${code})`, { cause: error });
}
function answerOf(res, failure2) {
  const headers = [];
  const raw = res.rawHeaders;
  for (let index = 0; index + 1 < raw.length; index += 2) {
    headers.push([(raw[index] ?? "").toLowerCase(), raw[index + 1] ?? ""]);
  }
  return {
    status: res.statusCode ?? 0,
    headers,
    get(name) {
      const value = res.headers[name.toLowerCase()];
      if (value === void 0) return null;
      return Array.isArray(value) ? value.join(", ") : value;
    },
    body: res,
    discard() {
      if (res.readableEnded || res.destroyed) return;
      let bytes = 0;
      const timer = setTimeout(() => res.destroy(), DISCARD_TIMEOUT_MS);
      timer.unref();
      res.once("close", () => clearTimeout(timer));
      res.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > DISCARD_LIMIT_BYTES) res.destroy();
      });
      res.resume();
    },
    failure: failure2
  };
}
function forwardBody(answer2, res, signal) {
  const body = answer2.body;
  return new Promise((resolve8) => {
    let settled = false;
    const settle2 = (outcome) => {
      if (settled) return;
      settled = true;
      body.off("data", onData);
      body.off("end", onEnd);
      res.off("drain", onDrain);
      res.off("finish", onFinish);
      res.off("close", onClose);
      signal.removeEventListener("abort", onAbort);
      stopWatching();
      resolve8(outcome);
    };
    const onData = (chunk) => {
      if (!res.write(chunk)) body.pause();
    };
    const onDrain = () => {
      body.resume();
    };
    const onEnd = () => {
      res.end();
    };
    const onFinish = () => settle2("done");
    const onClose = () => {
      if (res.writableFinished) {
        settle2("done");
        return;
      }
      settle2("aborted");
      body.destroy();
    };
    const onAbort = () => {
      settle2("aborted");
      body.destroy();
      res.destroy();
    };
    const stopWatching = (0, import_node_stream.finished)(body, (error) => {
      if (error === void 0 || error === null || settled) return;
      settle2("failed");
      res.destroy();
    });
    if (signal.aborted) {
      onAbort();
      return;
    }
    if (res.destroyed) {
      onClose();
      return;
    }
    body.on("data", onData);
    body.once("end", onEnd);
    res.on("drain", onDrain);
    res.once("finish", onFinish);
    res.once("close", onClose);
    signal.addEventListener("abort", onAbort, { once: true });
    body.resume();
  });
}

// src/daemon/proxy.ts
var MAX_REQUEST_BODY_BYTES = 64 * 1024 * 1024;
var TOO_LARGE_LINGER_MS = 5e3;
var MAX_KEPT_ANSWER_BYTES = 256 * 1024;
var KEPT_ANSWER_TIMEOUT_MS = 5e3;
var RENEWAL_WAIT_MS = 5e3;
var ClientGone = class extends Error {
};
function createProxy(options) {
  const { table, tokens, identity, poller, upstream, log, now } = options;
  const random = options.random ?? Math.random;
  const holdMs = options.hold?.holdMs ?? CAPACITY_HOLD_MS;
  const cooling = new CapacityCooling({ baseMs: options.hold?.baseMs ?? CAPACITY_HOLD_BASE_MS, maxMs: options.hold?.maxMs ?? CAPACITY_HOLD_MAX_MS });
  const maxBodyBytes = options.maxBodyBytes ?? MAX_REQUEST_BODY_BYTES;
  const renewalWaitMs = options.renewalWaitMs ?? RENEWAL_WAIT_MS;
  const lingerMs = options.tooLargeLingerMs ?? TOO_LARGE_LINGER_MS;
  const keptAnswerTimeoutMs = options.keptAnswerTimeoutMs ?? KEPT_ANSWER_TIMEOUT_MS;
  let open4 = 0;
  let drainWaiters = [];
  const finished2 = () => {
    open4--;
    if (open4 === 0) {
      const waiters = drainWaiters;
      drainWaiters = [];
      for (const resolve8 of waiters) resolve8();
    }
  };
  async function handle(req, res) {
    const info = readRouteRequest((name) => headerValue(req, name), table.ownLogin("claude").id);
    if (!routeKeyMatches(info.key, options.key)) {
      log.write("proxy_rejected", { reason: "bad_secret", method: methodOf(req.method) });
      req.resume();
      res.writeHead(403).end();
      return;
    }
    const problem = headerProblem(info);
    if (problem !== null) {
      log.write("proxy_rejected", { reason: "invalid", method: methodOf(req.method) });
      req.resume();
      send(res, invalidRequest(problem));
      return;
    }
    open4++;
    const controller = new AbortController();
    const onClose = () => {
      if (!res.writableFinished) controller.abort(new ClientGone());
    };
    res.on("close", onClose);
    try {
      await route(req, res, info, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) {
        if (!res.writableFinished) res.destroy();
      } else {
        log.write("internal_error", { code: errorCodeOf(error) });
        if (!res.headersSent) send(res, apiError(502, "The kurmis proxy failed to handle the request."));
        else res.destroy();
      }
    } finally {
      res.off("close", onClose);
      controller.abort();
      finished2();
    }
  }
  function headerProblem(info) {
    if (info.login === "invalid") return "The x-kurmis-login header is not a login id.";
    if (info.startedOn === "invalid") return 'The x-kurmis-started-on header is neither a login id nor "none".';
    if (info.login === null) return null;
    table.checkConfig();
    return table.find(info.login)?.provider === "claude" ? null : "The x-kurmis-login header does not name a Claude login.";
  }
  function accountUuidOf(id) {
    const login = table.find(id);
    return login === void 0 ? null : identity.read(login)?.accountUuid ?? null;
  }
  async function route(req, res, info, signal) {
    const arrived = now();
    const read = await readBody2(req, maxBodyBytes, signal);
    if (read === "too-large") {
      log.write("proxy_rejected", { reason: "invalid", status: 413 });
      refuseTooLarge2(req, res, maxBodyBytes, lingerMs);
      return;
    }
    const body = read.length === 0 ? void 0 : read;
    if (body !== void 0 && !isJson(body)) {
      log.write("proxy_rejected", { reason: "invalid", status: 400 });
      send(res, invalidRequest("The request body is not JSON."));
      return;
    }
    table.checkConfig();
    const ownClaude = table.ownLogin("claude").id;
    const sessionKey = info.sessionId !== null && isSessionId(info.sessionId) ? info.sessionId : NO_SESSION_KEY;
    let sentBack = info.login === null ? table.heldLogin(sessionKey) : null;
    let sentBackHere = false;
    let leftAnswer = null;
    const pinned = info.login ?? sentBack;
    const session = {
      homeAccountId: pinned ?? ownClaude,
      currentAccountId: table.sessionLogin(sessionKey),
      pinnedAccountId: pinned
    };
    const startedOn = info.startedOn;
    const callerAuthorization = headerValue(req, "authorization") ?? null;
    const rowsNow = () => table.routeRows(startedOn, callerAuthorization !== null, info.login);
    const attempted = /* @__PURE__ */ new Set();
    const excluded = /* @__PURE__ */ new Set();
    const refreshed = /* @__PURE__ */ new Set();
    const renewed = /* @__PURE__ */ new Set();
    const reread = /* @__PURE__ */ new Set();
    const refusals = [];
    let holdSince = cooling.coolingOf(sessionKey, now()) === null ? null : arrived;
    const renewable = (row) => !renewed.has(row.id) && tokens.read(row.id)?.hasRefreshToken === true;
    const endPinBack = () => {
      if (sentBack === null) return;
      table.releaseSession(sessionKey);
      sentBack = null;
      sentBackHere = false;
      session.pinnedAccountId = null;
      session.homeAccountId = ownClaude;
    };
    const pinBackEnds = (rows) => {
      if (sentBack === null) return false;
      if (excluded.has(sentBack)) return true;
      if (sentBackHere) return false;
      const row = rows.find((each) => each.id === sentBack);
      if (row === void 0) return true;
      const measured = {
        ...row,
        autoRoute: true,
        fiveHourLimitPercent: 100,
        weeklyLimitPercent: 100,
        ...renewable(row) ? { tokenExpiresAt: null } : {}
      };
      return routeBlock(measured, now()) !== null;
    };
    const pick = async () => {
      for (; ; ) {
        await abortable(tokens.prime(table.claudeLogins().map((login) => login.id)), signal);
        const rows = rowsNow();
        const stale = staleUsageLogins(session, rows, now(), /* @__PURE__ */ new Set([...refreshed, ...poller.recentStaleProbes()]));
        if (stale.length > 0) {
          for (const id of stale) refreshed.add(id);
          await abortable(poller.probeMany(stale, "stale"), signal);
          continue;
        }
        if (sentBack !== null && pinBackEnds(rows)) {
          log.write("session_hold_ended", { login: asLogin(sentBack) });
          endPinBack();
          continue;
        }
        const scope = new Set(accountsInScope(session, rows).map((row2) => row2.id));
        const blocked = /* @__PURE__ */ new Set([...excluded, ...cooling.waitFor(sessionKey, scope, now()).cooling]);
        const candidates = rows.map((row2) => renewable(row2) ? { ...row2, tokenExpiresAt: null } : row2);
        const chosen = chooseAccount(session, candidates, now(), blocked);
        if (chosen === null) return null;
        const row = rows.find((each) => each.id === chosen.id) ?? chosen;
        if (tokenIsFresh(row.tokenExpiresAt, now())) return row;
        if (!reread.has(row.id)) {
          reread.add(row.id);
          tokens.invalidate(row.id);
          await abortable(tokens.prime([row.id]), signal);
          continue;
        }
        if (!renewable(row)) {
          excluded.add(row.id);
          continue;
        }
        renewed.add(row.id);
        const elsewhere = effectivePin(session, rows) === null && chooseAccount(session, candidates, now(), /* @__PURE__ */ new Set([...blocked, row.id])) !== null;
        const renewal = poller.probe(row.id, "renewal");
        const finishedInTime = await abortable(elsewhere ? withTimeout(renewal, renewalWaitMs) : renewal.then(() => true), signal);
        if (!finishedInTime) excluded.add(row.id);
        tokens.invalidate(row.id);
      }
    };
    const place = (id) => {
      const placement = table.placeSession(sessionKey, id);
      const login = asLogin(id);
      if (placement.kind === "placed") log.write("session_placed", { login });
      else if (placement.kind === "moved") log.write("session_moved", { login, fromLogin: placement.from });
    };
    const giveHoldBack = () => {
      const heldMs = now() - (holdSince ?? arrived);
      const answer2 = capacityHoldAnswer(cooling.coolingOf(sessionKey, now())?.reason ?? "529 Overloaded", heldMs);
      log.write("request_failed", { reason: "overload", status: answer2.status, ms: heldMs });
      send(res, answer2);
    };
    for (; ; ) {
      signal.throwIfAborted();
      if (holdSince !== null && now() >= holdSince + holdMs) {
        giveHoldBack();
        return;
      }
      const row = await pick();
      if (row === null) {
        const rows = rowsNow();
        const scope = new Set(accountsInScope(session, rows).map((each) => each.id));
        const { wakeAt } = cooling.waitFor(sessionKey, scope, now());
        if (wakeAt !== null) {
          holdSince ??= arrived;
          await waitForPool(table, Math.min(wakeAt, holdSince + holdMs), now, signal);
          continue;
        }
        if (refusals.length === 0 && leftAnswer !== null) {
          log.write("request_forwarded", {
            login: asLogin(leftAnswer.login),
            method: methodOf(req.method),
            status: leftAnswer.status,
            ms: now() - arrived,
            attempt: attempted.size
          });
          res.writeHead(leftAnswer.status, downstreamResponseHeaders(leftAnswer.headers)).end(leftAnswer.body);
          return;
        }
        answerRefusal(res, session, rows, refusals, attempted, excluded, startedOn === null);
        return;
      }
      const token = tokens.read(row.id);
      const authorization = token !== null ? `Bearer ${token.accessToken}` : row.id === startedOn ? callerAuthorization : null;
      if (authorization === null) {
        excluded.add(row.id);
        continue;
      }
      const outgoing = upstreamRequest(req.headers, body, authorization, accountUuidOf(row.id));
      attempted.add(row.id);
      const holdLeft = holdSince === null ? null : holdSince + holdMs - now();
      const holdOver = new AbortController();
      const holdTimer = holdLeft === null ? null : setTimeout(() => {
        holdOver.abort();
      }, Math.max(0, holdLeft));
      const attemptSignal = holdLeft === null ? signal : AbortSignal.any([signal, holdOver.signal]);
      let answer2;
      try {
        answer2 = await upstream.send({
          method: req.method ?? "GET",
          path: req.url ?? "/",
          headers: outgoing.headers,
          ...outgoing.body === void 0 ? {} : { body: outgoing.body },
          signal: attemptSignal
        });
      } catch (error) {
        signal.throwIfAborted();
        if (holdOver.signal.aborted) {
          giveHoldBack();
          return;
        }
        const kind = error instanceof UpstreamError ? error.kind : "network";
        log.write("request_failed", { login: asLogin(row.id), reason: kind === "timeout" ? "timeout" : "network", code: errorCodeOf(error) });
        send(res, apiError(kind === "timeout" ? 504 : 502, kind === "timeout" ? "The kurmis proxy got no answer from Anthropic in time." : "The kurmis proxy could not reach Anthropic's API."));
        return;
      } finally {
        if (holdTimer !== null) clearTimeout(holdTimer);
      }
      const status2 = answer2.status;
      const get = (name) => answer2.get(name);
      noteUsage(row.id, get);
      const until = quotaCooldownUntil(status2, get);
      if (until !== null) {
        table.setCooldown(row.id, until);
        log.write("cooldown_started", { login: asLogin(row.id), ...Number.isFinite(until) ? { until } : {} });
      }
      if (status2 === 401 && token !== null) {
        tokens.invalidate(row.id);
        if (token.hasRefreshToken && !renewed.has(row.id)) {
          answer2.discard();
          renewed.add(row.id);
          log.write("retry_other_login", { login: asLogin(row.id), reason: "unauthorized", status: status2 });
          await abortable(poller.probe(row.id, "renewal"), signal);
          tokens.invalidate(row.id);
          attempted.delete(row.id);
          continue;
        }
        if (row.id !== startedOn && info.login === null) {
          answer2.discard();
          excluded.add(row.id);
          table.markRefused(row.id);
          log.write("retry_other_login", { login: asLogin(row.id), reason: "unauthorized", status: status2 });
          continue;
        }
      }
      const capacity = capacityRefusal(status2, isDefinitiveQuotaRejection(status2, get));
      if (capacity !== null) {
        answer2.discard();
        const note = cooling.noteNoCapacity(sessionKey, row.id, capacity, get("retry-after"), random(), now());
        holdSince ??= arrived;
        log.write("retry_after_backoff", { login: asLogin(row.id), reason: "overload", status: status2, attempt: note.attempt, ms: note.delayMs });
        continue;
      }
      cooling.noteAnswered(sessionKey);
      if (until !== null && sentBack !== null && row.id === sentBack) {
        log.write("session_hold_ended", { login: asLogin(sentBack), reason: "usage_limit" });
        endPinBack();
      }
      const decision = replayDecision({ status: status2, get, servedBy: row.id, session, attempted });
      if (decision.kind === "replay") {
        refusals.push({ login: row.id, until: decision.cooldownUntil, status: status2, headers: answer2.headers, body: await keepBody(answer2, signal, keptAnswerTimeoutMs) });
        excluded.add(row.id);
        log.write("retry_other_login", { login: asLogin(row.id), reason: "usage_limit", status: status2 });
        continue;
      }
      if (decision.kind === "pin-back") {
        leftAnswer = { login: row.id, until: Infinity, status: status2, headers: answer2.headers, body: await keepBody(answer2, signal, keptAnswerTimeoutMs) };
        excluded.add(row.id);
        session.pinnedAccountId = decision.to;
        session.homeAccountId = decision.to;
        sentBack = decision.to;
        sentBackHere = true;
        table.holdSession(sessionKey, decision.to);
        log.write("retry_other_login", { login: asLogin(decision.to), fromLogin: asLogin(row.id), reason: "pinned", status: status2 });
        continue;
      }
      if (status2 < 400) place(row.id);
      res.writeHead(status2, downstreamResponseHeaders(answer2.headers));
      res.flushHeaders();
      const result = await forwardBody(answer2, res, signal);
      log.write(result === "done" ? "request_forwarded" : "request_failed", {
        login: asLogin(row.id),
        method: methodOf(req.method),
        status: status2,
        ms: now() - arrived,
        ...result === "failed" ? { reason: "upstream_error" } : {},
        ...attempted.size > 1 ? { attempt: attempted.size } : {}
      });
      return;
    }
  }
  function noteUsage(id, get) {
    table.noteObservation(id, parseUnifiedHeaders(get, now()));
  }
  function answerRefusal(res, session, rows, refusals, attempted, excluded, cliOnOwnCredentials) {
    const fields = { count: attempted.size };
    if (refusals.length > 0) {
      const first = [...refusals].sort((a, b) => a.until - b.until)[0];
      const refused = new Set(refusals.map((refusal) => refusal.login));
      const pool = poolLimitAnswer(session, rows.filter((row) => !excluded.has(row.id) || refused.has(row.id)), now());
      if (pool.resetAt !== null && pool.resetAt < first.until) {
        log.write("pool_exhausted", { ...fields, reason: "usage_limit", status: pool.status, until: pool.resetAt });
        send(res, pool);
        return;
      }
      log.write("pool_exhausted", {
        ...fields,
        reason: "usage_limit",
        status: first.status,
        login: asLogin(first.login),
        ...Number.isFinite(first.until) ? { until: first.until } : {}
      });
      res.writeHead(first.status, downstreamResponseHeaders(first.headers)).end(first.body);
      return;
    }
    const answer2 = refusalAnswer(session, rows, now(), cliOnOwnCredentials);
    log.write("pool_exhausted", {
      ...fields,
      reason: answer2.kind === "no-signer" ? "no_credentials" : "usage_limit",
      status: answer2.status,
      ...answer2.resetAt === null ? {} : { until: answer2.resetAt }
    });
    send(res, answer2);
  }
  return {
    handle: (req, res) => handle(req, res).catch(() => {
      if (!res.writableFinished) res.destroy();
    }),
    openRequests: () => open4,
    drained: () => open4 === 0 ? Promise.resolve() : new Promise((resolve8) => {
      drainWaiters.push(resolve8);
    })
  };
}
function headerValue(req, name) {
  const value = req.headers[name.toLowerCase()];
  const text2 = Array.isArray(value) ? value[0] : value;
  return text2 === void 0 || text2.length === 0 ? void 0 : text2;
}
function isJson(bytes) {
  try {
    JSON.parse(bytes.toString("utf8"));
    return true;
  } catch {
    return false;
  }
}
function asLogin(id) {
  return isLoginId(id) ? id : void 0;
}
function send(res, answer2) {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(answer2.status, answer2.headers).end(answer2.body);
}
function invalidRequest(message) {
  return {
    status: 400,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "error", error: { type: "invalid_request_error", message } })
  };
}
function apiError(status2, message) {
  return {
    status: status2,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "error", error: { type: "api_error", message } })
  };
}
function readBody2(req, max, signal) {
  return new Promise((resolve8, reject) => {
    const chunks = [];
    let size = 0;
    const settle2 = () => {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
      req.off("close", onClose);
      signal.removeEventListener("abort", onAbort);
    };
    const onData = (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > max) {
        settle2();
        chunks.length = 0;
        resolve8("too-large");
        return;
      }
      chunks.push(bytes);
    };
    const onEnd = () => {
      settle2();
      resolve8(Buffer.concat(chunks));
    };
    const onError = (error) => {
      settle2();
      reject(error);
    };
    const onClose = () => {
      settle2();
      reject(new Error("the request ended before its body was complete"));
    };
    const onAbort = () => {
      settle2();
      reject(signal.reason);
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    req.on("data", onData);
    req.once("end", onEnd);
    req.once("error", onError);
    req.once("close", onClose);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
function refuseTooLarge2(req, res, max, lingerMs) {
  if (res.headersSent || res.destroyed) return;
  const socket = req.socket;
  req.resume();
  res.once("finish", () => {
    socket.end();
    const timer = setTimeout(() => {
      socket.destroy();
    }, lingerMs);
    timer.unref();
    socket.once("close", () => {
      clearTimeout(timer);
    });
  });
  res.writeHead(413, { "content-type": "application/json" }).end(JSON.stringify({
    type: "error",
    error: { type: "request_too_large", message: `The request body is larger than the ${String(Math.round(max / 1024 / 1024))} MB the kurmis proxy takes.` }
  }));
}
async function keepBody(answer2, signal, timeoutMs) {
  const chunks = [];
  let size = 0;
  const body = answer2.body;
  const timer = setTimeout(() => {
    body.destroy();
  }, timeoutMs);
  const onAbort = () => {
    body.destroy();
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    for await (const chunk of body) {
      signal.throwIfAborted();
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (size + bytes.length > MAX_KEPT_ANSWER_BYTES) {
        answer2.discard();
        break;
      }
      chunks.push(bytes);
      size += bytes.length;
    }
  } catch {
    signal.throwIfAborted();
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
  signal.throwIfAborted();
  return Buffer.concat(chunks);
}
function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve8, reject) => {
    const aborted = () => {
      reject(signal.reason);
    };
    signal.addEventListener("abort", aborted, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", aborted);
        resolve8(value);
      },
      (error) => {
        signal.removeEventListener("abort", aborted);
        reject(error);
      }
    );
  });
}
function withTimeout(promise, ms) {
  return new Promise((resolve8) => {
    const timer = setTimeout(() => {
      resolve8(false);
    }, ms);
    void promise.finally(() => {
      clearTimeout(timer);
      resolve8(true);
    });
  });
}
function waitForPool(table, until, now, signal) {
  return new Promise((resolve8, reject) => {
    const settle2 = () => {
      clearTimeout(timer);
      unsubscribe();
      signal.removeEventListener("abort", aborted);
    };
    const woken = () => {
      settle2();
      resolve8();
    };
    const aborted = () => {
      settle2();
      reject(signal.reason);
    };
    const timer = setTimeout(woken, Math.max(0, until - now()));
    const unsubscribe = table.onChange(woken);
    if (signal.aborted) aborted();
    else signal.addEventListener("abort", aborted, { once: true });
  });
}

// src/daemon/tokens.ts
var import_node_fs16 = require("node:fs");
var import_node_os11 = require("node:os");
var import_node_path18 = require("node:path");

// src/daemon/credentials.ts
var import_node_fs15 = require("node:fs");
var import_node_path17 = require("node:path");

// src/core/credentials.ts
function parseCredentials(text2) {
  try {
    const parsed = JSON.parse(text2);
    const oauth = parsed?.claudeAiOauth;
    if (typeof oauth?.accessToken !== "string" || oauth.accessToken.trim().length === 0) return null;
    return {
      accessToken: oauth.accessToken,
      expiresAt: typeof oauth.expiresAt === "number" && Number.isFinite(oauth.expiresAt) ? oauth.expiresAt : null,
      hasRefreshToken: typeof oauth.refreshToken === "string" && oauth.refreshToken.trim().length > 0
    };
  } catch {
    return null;
  }
}

// src/daemon/credentials.ts
var CREDENTIALS_FILE_NAME = ".credentials.json";
var CredentialsFileReader = class {
  constructor(options) {
    this.options = options;
  }
  options;
  cache = /* @__PURE__ */ new Map();
  read(id) {
    const path = this.pathOf(id);
    try {
      const stat2 = (0, import_node_fs15.statSync)(path);
      const cached = this.cache.get(path);
      if (cached?.mtime === stat2.mtimeMs && cached.size === stat2.size) return cached.value;
      let value = null;
      try {
        value = parseCredentials((0, import_node_fs15.readFileSync)(path, "utf8"));
      } catch {
      }
      this.cache.set(path, { mtime: stat2.mtimeMs, size: stat2.size, value });
      return value;
    } catch {
      this.cache.delete(path);
      return null;
    }
  }
  /** Nothing to do: `read` reads the file itself. */
  prime(_ids) {
    return Promise.resolve();
  }
  invalidate(id) {
    this.cache.delete(this.pathOf(id));
  }
  clear() {
    this.cache.clear();
  }
  pathOf(id) {
    return (0, import_node_path17.join)(this.options.credentialsDir(id), CREDENTIALS_FILE_NAME);
  }
};

// src/platform/windows-credentials.ts
var import_node_os10 = require("node:os");

// src/core/keychain-service.ts
var import_node_crypto9 = require("node:crypto");
var KEYCHAIN_SERVICE_BASE = "Claude Code-credentials";
function keychainService(secureStorageDir) {
  if (secureStorageDir === null || secureStorageDir.length === 0) return KEYCHAIN_SERVICE_BASE;
  const digest = (0, import_node_crypto9.createHash)("sha256").update(secureStorageDir.normalize("NFC")).digest("hex");
  return `${KEYCHAIN_SERVICE_BASE}-${digest.slice(0, 8)}`;
}

// src/platform/windows-credentials.ts
function powerShellQuote(text2) {
  return `'${text2.replace(/['\u2018\u2019\u201a\u201b]/g, (quote) => quote + quote)}'`;
}
function powerShellInvocation(script, env) {
  return {
    program: systemProgram("powershell", env),
    args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")]
  };
}
var CREDENTIAL_USER_NAME = "claude-code-user";
var CHUNK_CHARS = 2400;
var MAX_CHUNKS = 256;
var CREDENTIAL_READ_TIMEOUT_MS = 2e4;
var MAX_ENCODED_COMMAND_CHARS = 3e4;
function credentialFilter(secureStorageDir) {
  return `${keychainService(secureStorageDir)}/*`;
}
function credEnumScript(filters) {
  return [
    "$ErrorActionPreference='Stop'",
    "$ProgressPreference='SilentlyContinue'",
    "Add-Type -TypeDefinition @'",
    "using System;",
    "using System.Text;",
    "using System.Runtime.InteropServices;",
    "public static class KurmisCredEnum {",
    "  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]",
    "  private struct CREDENTIAL {",
    "    public int Flags; public int Type; public IntPtr TargetName; public IntPtr Comment;",
    "    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;",
    "    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;",
    "    public int AttributeCount; public IntPtr Attributes; public IntPtr TargetAlias; public IntPtr UserName;",
    "  }",
    '  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]',
    "  private static extern bool CredEnumerateW(string filter, int flags, out int count, out IntPtr credentials);",
    '  [DllImport("advapi32.dll")]',
    "  private static extern void CredFree(IntPtr buffer);",
    "  public static string[] List(string filter) {",
    "    int count; IntPtr p;",
    "    if (!CredEnumerateW(filter, 0, out count, out p)) {",
    "      int e = Marshal.GetLastWin32Error();",
    '      return new string[] { e == 1168 ? ". 0" : "! " + e };',
    "    }",
    "    try {",
    "      string[] lines = new string[count + 1];",
    "      int found = 0;",
    "      for (int i = 0; i < count; i++) {",
    "        CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(Marshal.ReadIntPtr(p, i * IntPtr.Size), typeof(CREDENTIAL));",
    "        if (c.Type != 1) continue;",
    "        byte[] b = new byte[c.CredentialBlobSize];",
    "        if (c.CredentialBlobSize > 0) Marshal.Copy(c.CredentialBlob, b, 0, c.CredentialBlobSize);",
    "        string name = Marshal.PtrToStringUni(c.TargetName);",
    '        lines[found++] = "+ " + Convert.ToBase64String(Encoding.UTF8.GetBytes(name)) + " " + Convert.ToBase64String(b);',
    "      }",
    '      lines[found] = ". " + found;',
    "      string[] output = new string[found + 1];",
    "      Array.Copy(lines, output, found + 1);",
    "      return output;",
    "    } finally { CredFree(p); }",
    "  }",
    "}",
    "'@",
    `$filters=@(${filters.map(powerShellQuote).join(",")})`,
    'for($i=0;$i -lt $filters.Count;$i++){foreach($line in [KurmisCredEnum]::List($filters[$i])){Write-Output ("$i "+$line)}}'
  ].join("\n");
}
function parseCredEnumOutput(stdout, count) {
  const items = Array.from({ length: count }, () => /* @__PURE__ */ new Map());
  const answers = new Array(count);
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^(\d+) (?:\+ ([A-Za-z0-9+/=]+)(?: ([A-Za-z0-9+/=]*))?|\. (\d+)|! (\d+))$/.exec(line.trim());
    if (match === null) continue;
    const index = Number(match[1]);
    const mine = items[index];
    if (mine === void 0 || answers[index] !== void 0) continue;
    if (match[2] !== void 0) mine.set(Buffer.from(match[2], "base64").toString("utf8"), Buffer.from(match[3] ?? "", "base64"));
    else if (match[4] !== void 0) answers[index] = Number(match[4]) === mine.size ? { kind: "items", items: mine } : void 0;
    else answers[index] = { kind: "error", code: Number(match[5]) };
  }
  const all = [];
  for (const answer2 of answers) {
    if (answer2 === void 0) return null;
    all.push(answer2);
  }
  return all.length === count ? all : null;
}
function encodedLength(filters) {
  return Math.ceil(Buffer.byteLength(credEnumScript(filters), "utf16le") / 3) * 4;
}
function credentialBatches(filters, maxChars = MAX_ENCODED_COMMAND_CHARS) {
  const batches = [];
  let batch = [];
  for (const filter of filters) {
    if (batch.length > 0 && encodedLength([...batch, filter]) > maxChars) {
      batches.push(batch);
      batch = [];
    }
    batch.push(filter);
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}
function failureOf2(result) {
  if (result.error !== null) return result.error;
  const said = result.stderr.replace(/\s+/g, " ").trim();
  return `PowerShell exited with code ${String(result.code)}${said === "" ? "" : `: ${said.slice(0, 300)}`}`;
}
function powerShellCredentialRead(env, run2 = runProgram) {
  return async (filters) => {
    const all = [];
    for (const batch of credentialBatches(filters)) {
      const { program, args } = powerShellInvocation(credEnumScript(batch), env);
      const result = await run2(program, args, { timeoutMs: CREDENTIAL_READ_TIMEOUT_MS, env, maxOutputBytes: 16 * 1024 * 1024 });
      if (result.code !== 0 || result.error !== null) throw new Error(failureOf2(result));
      const answers = parseCredEnumOutput(result.stdout, batch.length);
      if (answers === null) throw new Error("PowerShell did not answer for every login");
      all.push(...answers);
    }
    return all;
  };
}
function preferredAccounts(env = process.env, userName = () => (0, import_node_os10.userInfo)().username) {
  let name;
  try {
    name = env.USER || userName();
  } catch {
    name = CREDENTIAL_USER_NAME;
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) name = CREDENTIAL_USER_NAME;
  return [.../* @__PURE__ */ new Set([name, CREDENTIAL_USER_NAME])];
}
function byAccount(service, items) {
  const prefix = `${service}/`.toLowerCase();
  const accounts = /* @__PURE__ */ new Map();
  for (const [name, blob] of items) {
    if (!name.toLowerCase().startsWith(prefix)) continue;
    const match = /^(.*?)(#m|#\d+)?$/.exec(name.slice(prefix.length));
    const account = (match?.[1] ?? "").toLowerCase();
    const suffix = match?.[2] ?? "";
    let entries = accounts.get(account);
    if (entries === void 0) accounts.set(account, entries = /* @__PURE__ */ new Map());
    entries.set(suffix, blob);
  }
  return accounts;
}
function chooseAccount2(accounts, preferred) {
  const lower = accounts.map((account) => account.toLowerCase());
  for (const name of preferred) if (lower.includes(name.toLowerCase())) return name.toLowerCase();
  return lower.length === 1 ? lower[0] ?? null : null;
}
function chunkCount(blob) {
  if (blob === void 0) return null;
  let value;
  try {
    value = JSON.parse(blob.toString("utf8"));
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { n, l } = value;
  if (typeof n !== "number" || typeof l !== "number" || !Number.isInteger(n) || !Number.isInteger(l)) return null;
  return n > 0 && n <= MAX_CHUNKS && l > 0 && l <= n * CHUNK_CHARS ? { n, l } : null;
}
function recordFromItems(service, items, preferred) {
  const accounts = byAccount(service, items);
  if (accounts.size === 0) return { kind: "missing" };
  const account = chooseAccount2([...accounts.keys()], preferred);
  if (account === null) return { kind: "failed", reason: "Credential Manager has records under several account names, and none is the expected one" };
  const entries = accounts.get(account) ?? /* @__PURE__ */ new Map();
  const count = chunkCount(entries.get("#m"));
  if (count === null) {
    const plain = entries.get("");
    return plain === void 0 ? { kind: "missing" } : { kind: "found", text: plain.toString("utf8") };
  }
  const slices = [];
  for (let i = 0; i < count.n; i++) {
    const slice = entries.get(`#${String(i)}`);
    if (slice === void 0) return { kind: "failed", reason: "a slice of the chunked record is missing" };
    slices.push(slice.toString("utf8"));
  }
  const joined = slices.join("");
  return joined.length === count.l ? { kind: "found", text: Buffer.from(joined, "base64").toString("utf8") } : { kind: "failed", reason: "the slices of the chunked record do not add up to its length" };
}
async function readStoredRecords(secureStorageDirs, read, preferred = preferredAccounts()) {
  const filters = [...new Set(secureStorageDirs.map(credentialFilter))];
  const answers = await read(filters);
  return secureStorageDirs.map((dir) => {
    const answer2 = answers[filters.indexOf(credentialFilter(dir))];
    if (answer2 === void 0) return { kind: "failed", reason: "PowerShell did not answer for this login" };
    if (answer2.kind === "error") return { kind: "failed", reason: `CredEnumerateW failed with Win32 error ${String(answer2.code)}` };
    return recordFromItems(keychainService(dir), answer2.items, preferred);
  });
}
async function holdsStoredRecord(secureStorageDir, env, platform = process.platform, read = powerShellCredentialRead(env)) {
  if (platform !== "win32") return false;
  try {
    const [record2] = await readStoredRecords([secureStorageDir], read);
    return record2?.kind === "found";
  } catch {
    return false;
  }
}

// src/daemon/keychain.ts
var KEYCHAIN_CACHE_MS = 6e4;
var KEYCHAIN_READ_TIMEOUT_MS = 3e3;
var MAX_OUTPUT_BYTES = 256 * 1024;
var MAX_REASON_CHARS = 500;
function keychainHoldsSecret(platform = process.platform) {
  return platform === "darwin";
}
var KeychainReadError = class extends Error {
  constructor(reason, code, timedOut = false, outputTooLarge = false) {
    super(reason);
    this.reason = reason;
    this.code = code;
    this.timedOut = timedOut;
    this.outputTooLarge = outputTooLarge;
  }
  reason;
  code;
  timedOut;
  outputTooLarge;
};
var NO_SUCH_ITEM_EXIT_CODE = 44;
var KEYCHAIN_NOT_ALLOWED_EXIT_CODE = 36;
async function readKeychainItem(securityProgram, service, timeoutMs = KEYCHAIN_READ_TIMEOUT_MS) {
  const result = await runProgram(
    securityProgram,
    ["find-generic-password", "-w", "-s", service],
    { timeoutMs, maxOutputBytes: MAX_OUTPUT_BYTES }
  );
  const failure2 = failureOf3(result, timeoutMs);
  if (failure2 !== null) throw new KeychainReadError(failure2, result.code, result.timedOut, result.outputTooLarge);
  return result.stdout.trim().length === 0 ? null : result.stdout;
}
function failureOf3(result, timeoutMs) {
  if (result.timedOut) return `it did not answer within ${seconds2(timeoutMs)} seconds`;
  if (result.outputTooLarge) return `it printed more than ${String(MAX_OUTPUT_BYTES)} bytes, which is not a credentials record`;
  if (result.error !== null) return result.error;
  if (result.code === 0) return null;
  const said = result.stderr.trim();
  return said.length > 0 ? said.slice(0, MAX_REASON_CHARS) : "it printed nothing on stderr";
}
function seconds2(ms) {
  return String(ms / 1e3);
}
var KeychainCredentialsReader = class {
  constructor(options) {
    this.options = options;
  }
  options;
  cache = /* @__PURE__ */ new Map();
  /** The read of each login going on now, with the `invalidations` count it started under. */
  reading = /* @__PURE__ */ new Map();
  /** How often each login was invalidated. */
  invalidations = /* @__PURE__ */ new Map();
  /** The logins whose failed read has been logged, until a read of one works. */
  failureLogged = /* @__PURE__ */ new Set();
  /**
   * The items whose read was killed at its deadline. A `security` that does not answer is most
   * likely showing a Keychain dialog that nobody is there to answer, and reading the item again
   * would show another one, so none of these is read again by this reader. Neither `invalidate`
   * nor `clear` empties it.
   */
  unanswered = /* @__PURE__ */ new Set();
  read(id) {
    return this.cache.get(id)?.value ?? null;
  }
  async prime(ids) {
    await Promise.all([...new Set(ids)].map((id) => this.refresh(id)));
  }
  invalidate(id) {
    this.invalidations.set(id, this.invalidatedCount(id) + 1);
    const cached = this.cache.get(id);
    if (cached !== void 0) this.cache.set(id, { ...cached, readAt: Number.NEGATIVE_INFINITY });
  }
  clear() {
    this.cache.clear();
    for (const id of this.reading.keys()) this.invalidations.set(id, this.invalidatedCount(id) + 1);
  }
  /**
   * One read per login at a time; a second caller waits for the one already running. A read
   * that started before the latest `invalidate` is waited for and then followed by a new one.
   */
  refresh(id) {
    const cached = this.cache.get(id);
    if (cached && this.now() - cached.readAt < KEYCHAIN_CACHE_MS) return Promise.resolve();
    const invalidated = this.invalidatedCount(id);
    const running = this.reading.get(id);
    if (running !== void 0) {
      return running.invalidated === invalidated ? running.promise : running.promise.then(() => this.refresh(id));
    }
    const promise = this.load(id, invalidated).finally(() => {
      this.reading.delete(id);
    });
    this.reading.set(id, { promise, invalidated });
    return promise;
  }
  invalidatedCount(id) {
    return this.invalidations.get(id) ?? 0;
  }
  async load(id, invalidated) {
    const timeoutMs = this.options.readTimeoutMs ?? KEYCHAIN_READ_TIMEOUT_MS;
    const run2 = this.options.run ?? ((service2) => readKeychainItem(this.options.securityProgram, service2, timeoutMs));
    const service = keychainService(this.options.accounts.secureStorageDir(id));
    const keep = (value2) => {
      if (this.invalidatedCount(id) !== invalidated) return false;
      this.cache.set(id, { readAt: this.now(), value: value2 });
      return true;
    };
    if (this.unanswered.has(service)) {
      keep(null);
      return;
    }
    let value = null;
    let failure2 = null;
    try {
      const secret = await run2(service);
      value = secret === null ? null : parseCredentials(secret);
      if (secret === null) failure2 = { text: "the item is empty", kind: "empty", code: null };
      else if (value === null) failure2 = { text: "the item holds no OAuth token", kind: "not_credentials", code: null };
    } catch (error) {
      if (error instanceof KeychainReadError && error.timedOut) {
        this.unanswered.add(service);
        keep(null);
        this.options.log?.(`reading login ${id} from the Keychain item "${service}" did not answer within ${seconds2(timeoutMs)} seconds, so the proxy holds no token for it, and this daemon will not read that item again until it restarts. A read that waits is usually a Keychain dialog: either a program other than the Claude CLI created the item or changed its access list, so /usr/bin/security may read it only after somebody allows it, or the login Keychain is locked. Reading again would put up another dialog.`);
        this.options.onFailure?.({ id, kind: "timeout", code: null });
        return;
      }
      if (!(error instanceof KeychainReadError && error.code === NO_SUCH_ITEM_EXIT_CODE)) {
        failure2 = error instanceof KeychainReadError ? {
          text: `${error.code === null ? "no exit code" : `exit ${String(error.code)}`}: ${error.reason}`,
          kind: failureKindOf(error),
          code: error.code
        } : { text: `it threw: ${error instanceof Error ? error.message : String(error)}`, kind: "failed", code: null };
      }
    }
    if (!keep(value)) return;
    if (failure2 === null) {
      this.failureLogged.delete(id);
    } else if (!this.failureLogged.has(id)) {
      this.failureLogged.add(id);
      this.options.log?.(`reading login ${id} from the Keychain item "${service}" failed, so the proxy holds no token for it (${failure2.text})`);
      this.options.onFailure?.({ id, kind: failure2.kind, code: failure2.code });
    }
  }
  now() {
    return this.options.now?.() ?? Date.now();
  }
};
function failureKindOf(error) {
  if (error.outputTooLarge) return "too_large";
  if (error.code === KEYCHAIN_NOT_ALLOWED_EXIT_CODE) return "not_allowed";
  if (error.code === null) return "not_run";
  return "failed";
}

// src/daemon/credential-manager.ts
var FILE_LOGIN_RECHECK_MS = 15 * 6e4;
function retryDelayMs(failures) {
  return Math.min(KEYCHAIN_CACHE_MS * 2 ** Math.max(0, failures - 1), FILE_LOGIN_RECHECK_MS);
}
var CredentialManagerReader = class {
  constructor(options) {
    this.options = options;
  }
  options;
  entries = /* @__PURE__ */ new Map();
  /** The logins whose last read that worked found their record here. */
  found = /* @__PURE__ */ new Set();
  /** The logins invalidated since their last read settled. */
  pending = /* @__PURE__ */ new Set();
  /** How often each login was invalidated; a read started before the latest one is not used. */
  invalidations = /* @__PURE__ */ new Map();
  /** How often `clear` ran; a read started before it is not used either. */
  clears = 0;
  failureLogged = /* @__PURE__ */ new Set();
  running = null;
  read(id) {
    return this.entries.get(id)?.value ?? null;
  }
  /** Whether the last read of the login that worked found its record in Credential Manager. */
  holds(id) {
    return this.found.has(id);
  }
  async prime(ids) {
    const wanted = [...new Set(ids)];
    const waitFor = wanted.filter((id) => this.found.has(id) || !this.options.fileExists(id));
    const unread = () => waitFor.some((id) => !this.entries.has(id) || this.pending.has(id));
    for (; ; ) {
      if (this.running !== null) {
        if (!unread()) return;
        await this.running;
        continue;
      }
      const due = wanted.filter((id) => this.isDue(id));
      if (due.length === 0) return;
      const run2 = this.load(due).finally(() => {
        if (this.running === run2) this.running = null;
      });
      this.running = run2;
      if (!unread()) return;
      await run2;
    }
  }
  /**
   * Has the next `prime` read the login again and wait for it where it waits for the login at
   * all. `read` goes on answering the old token until then.
   */
  invalidate(id) {
    this.invalidations.set(id, (this.invalidations.get(id) ?? 0) + 1);
    this.pending.add(id);
  }
  /**
   * Has the next `prime` read the login again in the background. A login whose last read
   * failed, or whose file exists and whose last read found no record here, keeps its longer wait.
   */
  markStale(id) {
    const entry = this.entries.get(id);
    if (entry !== void 0) entry.stale = true;
  }
  clear() {
    this.clears++;
    this.entries.clear();
    this.found.clear();
    this.pending.clear();
  }
  isDue(id) {
    const entry = this.entries.get(id);
    if (entry === void 0 || this.pending.has(id)) return true;
    const age = this.now() - entry.readAt;
    if (entry.failures > 0) return age >= retryDelayMs(entry.failures);
    if (!this.found.has(id) && this.options.fileExists(id)) return age >= FILE_LOGIN_RECHECK_MS;
    return entry.stale || age >= KEYCHAIN_CACHE_MS;
  }
  async load(ids) {
    const clears = this.clears;
    const started = new Map(ids.map((id) => [id, this.invalidations.get(id) ?? 0]));
    const settle2 = (id, outcome) => {
      if (this.clears === clears && (this.invalidations.get(id) ?? 0) === started.get(id)) this.settle(id, outcome);
    };
    let records;
    try {
      records = await readStoredRecords(ids.map((id) => this.options.secureStorageDir(id)), this.options.read, this.options.accounts);
    } catch {
      for (const id of ids) settle2(id, { kind: "failed", failure: "not_run" });
      return;
    }
    ids.forEach((id, index) => {
      const record2 = records[index];
      if (record2 === void 0 || record2.kind === "missing") settle2(id, { kind: "missing" });
      else if (record2.kind === "failed") settle2(id, { kind: "failed", failure: "failed" });
      else {
        const value = parseCredentials(record2.text);
        settle2(id, value === null ? { kind: "failed", failure: "not_credentials" } : { kind: "found", value });
      }
    });
  }
  settle(id, outcome) {
    this.pending.delete(id);
    const before = this.entries.get(id);
    const readAt = this.now();
    if (outcome.kind !== "failed") {
      this.entries.set(id, { value: outcome.kind === "found" ? outcome.value : null, readAt, failures: 0, stale: false });
      if (outcome.kind === "found") this.found.add(id);
      else this.found.delete(id);
      this.failureLogged.delete(id);
      return;
    }
    this.entries.set(id, { value: before?.value ?? null, readAt, failures: (before?.failures ?? 0) + 1, stale: false });
    if (!this.failureLogged.has(id) && (this.found.has(id) || !this.options.fileExists(id))) {
      this.failureLogged.add(id);
      this.options.onFailure?.({ id, kind: outcome.failure });
    }
  }
  now() {
    return this.options.now?.() ?? Date.now();
  }
};

// src/daemon/tokens.ts
function probeEnvironment(tokens, id, env) {
  return tokens.inCredentialManager(id) ? { ...env, [FORCE_CREDENTIAL_MANAGER_VARIABLE]: "1" } : env;
}
function securityProgramOf(env, processEnv = process.env) {
  return systemProgram("security", env, processEnv);
}
function claudeSecureStorageDir(login) {
  return checkedClaude(login).machineOwn ? null : loginFolder(login);
}
function claudeCredentialsDir(login, home) {
  return checkedClaude(login).machineOwn ? (0, import_node_path18.join)(home, ".claude") : loginFolder(login);
}
function createTokenSource(options) {
  const home = options.home ?? import_node_os11.homedir;
  const known = /* @__PURE__ */ new Map();
  const claudeLogin = (id) => {
    const seen = known.get(id);
    if (seen !== void 0) return seen;
    const found = isLoginId(id) ? options.login(id) : void 0;
    if (found?.provider !== "claude" || found.id !== id) return null;
    const login = { id: found.id, provider: "claude", machineOwn: found.machineOwn };
    known.set(id, login);
    return login;
  };
  const isClaude = (id) => claudeLogin(id) !== null;
  const checked = (id) => {
    const login = claudeLogin(id);
    if (login === null) throw new Error(`${id} is not the id of a Claude login.`);
    return login;
  };
  const file = new CredentialsFileReader({ credentialsDir: (id) => claudeCredentialsDir(checked(id), home()) });
  const credentialManager = (options.platform ?? process.platform) === "win32" ? new CredentialManagerReader({
    secureStorageDir: (id) => claudeSecureStorageDir(checked(id)),
    fileExists: (id) => (0, import_node_fs16.existsSync)((0, import_node_path18.join)(claudeCredentialsDir(checked(id), home()), CREDENTIALS_FILE_NAME)),
    read: options.credentialRead ?? powerShellCredentialRead(options.env),
    now: options.now,
    onFailure: (failure2) => {
      const login = claudeLogin(failure2.id);
      if (login !== null) options.log?.write("token_read_failed", { login: login.id, reason: credentialManagerReasonOf(failure2.kind) });
    }
  }) : null;
  const keychain = keychainHoldsSecret(options.platform ?? process.platform) ? new KeychainCredentialsReader({
    accounts: { secureStorageDir: (id) => claudeSecureStorageDir(checked(id)) },
    securityProgram: securityProgramOf(options.env),
    readTimeoutMs: options.keychainReadTimeoutMs,
    now: options.now,
    onFailure: (failure2) => {
      const login = claudeLogin(failure2.id);
      if (login !== null) options.log?.write("token_read_failed", { login: login.id, reason: logReasonOf(failure2.kind) });
    }
  }) : null;
  return {
    keychain: keychain !== null,
    read(id) {
      if (!isClaude(id)) return null;
      return credentialManager?.read(id) ?? keychain?.read(id) ?? file.read(id);
    },
    async prime(ids) {
      const claude = ids.filter(isClaude);
      await Promise.all([keychain?.prime(claude), credentialManager?.prime(claude)]);
    },
    invalidate(id) {
      if (!isClaude(id)) return;
      keychain?.invalidate(id);
      credentialManager?.invalidate(id);
      file.invalidate(id);
    },
    markStale(id) {
      if (!isClaude(id)) return;
      keychain?.invalidate(id);
      credentialManager?.markStale(id);
      file.invalidate(id);
    },
    inCredentialManager(id) {
      return isClaude(id) && credentialManager !== null && credentialManager.holds(id);
    },
    clear() {
      keychain?.clear();
      credentialManager?.clear();
      file.clear();
    }
  };
}
function logReasonOf(kind) {
  switch (kind) {
    case "timeout":
      return "timeout";
    case "not_allowed":
      return "not_allowed";
    case "empty":
    case "not_credentials":
    case "too_large":
      return "invalid";
    case "not_run":
    case "failed":
      return "other";
  }
}
function credentialManagerReasonOf(kind) {
  return kind === "not_credentials" ? "invalid" : "other";
}
function checkedClaude(login) {
  if (login.provider !== "claude") throw new Error(`${login.id} is not a Claude login.`);
  return login;
}

// src/daemon/usage-poller.ts
var POLL_INTERVAL_MS = 15 * 6e4;
var STALE_PROBE_INTERVAL_MS = 6e4;
var UsagePoller = class {
  constructor(options) {
    this.options = options;
  }
  options;
  running = /* @__PURE__ */ new Map();
  /** When each login was last asked for a probe because its reading was stale. */
  staleProbedAt = /* @__PURE__ */ new Map();
  controller = new AbortController();
  timer = null;
  closed = false;
  pollStopped = false;
  /** Probes every login once, then every signed-in login each `intervalMs`. */
  start() {
    if (this.closed || this.pollStopped || this.timer !== null) return;
    void this.probeMany(this.options.table.logins().map((login) => login.id), "start");
    this.timer = setInterval(() => {
      void this.probeMany(this.pollable(), "poll");
    }, this.options.intervalMs ?? POLL_INTERVAL_MS);
    this.timer.unref?.();
  }
  /**
   * Stops the timer of the poll, for a daemon that is stopping. Running probes and probes asked
   * for later still run.
   */
  stopPolling() {
    this.pollStopped = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
  /**
   * Stops the timer, kills the probes that are running and resolves once they have ended. A
   * probe ends only after its process has exited, so after this no probe's process holds the
   * data folder open: on Windows a running process's working folder or open file cannot be
   * deleted.
   */
  async close() {
    this.closed = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.controller.abort();
    await Promise.all(this.running.values());
  }
  /** Whether a probe of this login is running now. */
  isRunning(id) {
    return this.running.has(id);
  }
  /**
   * The logins a poll or a probe request without a list covers: every one signed in, and every
   * one not probed yet. A login whose last probe found it signed out is left out until a token
   * appears for it or the config changes.
   */
  pollable() {
    return this.options.table.logins().filter((login) => this.signedInOrUnknown(login)).map((login) => login.id);
  }
  /**
   * The logins a probe for a stale reading was asked for within the last
   * `STALE_PROBE_INTERVAL_MS`, whether that probe succeeded or not.
   */
  recentStaleProbes() {
    const since = this.options.now() - (this.options.staleProbeIntervalMs ?? STALE_PROBE_INTERVAL_MS);
    const recent = /* @__PURE__ */ new Set();
    for (const [id, at2] of this.staleProbedAt) {
      if (at2 > since) recent.add(id);
      else this.staleProbedAt.delete(id);
    }
    return recent;
  }
  /** Probes these logins, each once at a time, and resolves when all have finished. Never rejects. */
  async probeMany(ids, cause) {
    await Promise.all([...new Set(ids)].map((id) => this.probe(id, cause)));
  }
  /**
   * Probes one login. A probe of it that is already running is waited for rather than started
   * again. Never rejects.
   */
  probe(id, cause) {
    if (cause === "stale") this.staleProbedAt.set(id, this.options.now());
    const running = this.running.get(id);
    if (running !== void 0) return running;
    if (this.closed) return Promise.resolve();
    const login = this.options.table.find(id);
    if (login === void 0) return Promise.resolve();
    const started = this.run(login, cause).finally(() => {
      this.running.delete(id);
    });
    this.running.set(id, started);
    return started;
  }
  signedInOrUnknown(login) {
    if (login.provider === "claude") return this.options.table.claudeSignedIn(login.id) !== false;
    return this.options.table.probedSignedIn(login.id) !== false;
  }
  async run(login, cause) {
    const { table, log, now } = this.options;
    const id = login.id;
    const startedAt = now();
    log.write(cause === "renewal" ? "token_renewal_started" : "usage_probe_started", { login: id, provider: login.provider });
    const probe = login.provider === "claude" ? this.options.probeClaude : this.options.probeCodex;
    const ref = { id, provider: login.provider, machineOwn: login.machineOwn };
    let answer2;
    try {
      answer2 = await probe(ref, { env: this.options.env, now, signal: this.controller.signal, previous: table.usage(id) });
    } catch {
      answer2 = { ok: false, signedIn: null, reason: "other", error: "The usage probe failed unexpectedly." };
    }
    if (this.closed) return;
    if (login.provider === "claude") {
      if (cause === "renewal") this.options.tokens.invalidate(id);
      else this.options.tokens.markStale(id);
    }
    const ms = now() - startedAt;
    if (answer2.ok) {
      table.setProbeUsage(id, answer2.usage, startedAt);
      table.setSignedIn(id, answer2.signedIn);
      if (answer2.signedIn) table.clearRefused(id, startedAt);
      const before = table.cooldown(id);
      const setAt2 = table.cooldownSince(id);
      const after = setAt2 !== null && setAt2 > startedAt ? before : cooldownAfterProbe(before, answer2.usage);
      if (after !== before) {
        table.setCooldown(id, after);
        if (after === null) log.write("cooldown_ended", { login: id });
      }
      log.write(cause === "renewal" ? "token_renewal_finished" : "usage_probe_finished", { login: id, ms, ok: true });
      this.learnEmail(ref, answer2);
    } else {
      const previous = table.usage(id);
      const base = previous ?? (login.provider === "claude" ? emptyAccountUsage(id, now()) : emptyCodexUsage(id, now()));
      table.setUsage(id, { ...base, error: answer2.error });
      if (answer2.signedIn !== null) table.setSignedIn(id, answer2.signedIn);
      log.write(cause === "renewal" ? "token_renewal_finished" : "usage_probe_failed", { login: id, ms, ok: false, reason: answer2.reason });
    }
  }
  /**
   * Keeps what a successful probe said about the login's email: a Codex login's email in the
   * table's memory, and, when the probe found the login signed in and an email is known, the
   * login's automatic alias made from it.
   */
  learnEmail(login, answer2) {
    const { table, identity } = this.options;
    if (login.provider === "codex") table.setCodexEmail(login.id, answer2.signedIn ? answer2.email ?? null : null);
    if (!answer2.signedIn) return;
    const email = login.provider === "codex" ? answer2.email ?? null : identity.read(login)?.email ?? null;
    if (email !== null) table.noteEmail(login.id, email);
  }
};

// src/daemon/app.ts
function createDaemonApp(options) {
  const now = options.now ?? Date.now;
  const tuning = options.tuning ?? {};
  const { env, log, key } = options;
  const tokens = createTokenSource({
    login: (id) => table.find(id),
    env,
    log,
    now,
    ...tuning.platform === void 0 ? {} : { platform: tuning.platform }
  });
  const identity = new ClaudeIdentityReader();
  const table = new LoginTable({
    tokens,
    log,
    now,
    ...tuning.configCheckMs === void 0 ? {} : { configCheckMs: tuning.configCheckMs },
    ...tuning.stateWriteMs === void 0 ? {} : { stateWriteMs: tuning.stateWriteMs }
  });
  const poller = new UsagePoller({
    table,
    tokens,
    identity,
    env,
    log,
    now,
    probeClaude: tuning.probeClaude ?? ((login, probe) => probeClaudeUsage(login, { ...probe, env: probeEnvironment(tokens, login.id, probe.env) })),
    probeCodex: tuning.probeCodex ?? probeCodexUsage,
    ...tuning.pollIntervalMs === void 0 ? {} : { intervalMs: tuning.pollIntervalMs }
  });
  const upstream = createUpstream({
    origin: upstreamOrigin(env),
    ...tuning.upstreamIdleTimeoutMs === void 0 ? {} : { idleTimeoutMs: tuning.upstreamIdleTimeoutMs }
  });
  const proxy = createProxy({
    key,
    table,
    tokens,
    identity,
    poller,
    upstream,
    log,
    now,
    ...tuning.random === void 0 ? {} : { random: tuning.random },
    hold: {
      ...tuning.holdMs === void 0 ? {} : { holdMs: tuning.holdMs },
      ...tuning.holdBaseMs === void 0 ? {} : { baseMs: tuning.holdBaseMs },
      ...tuning.holdMaxMs === void 0 ? {} : { maxMs: tuning.holdMaxMs }
    },
    ...tuning.renewalWaitMs === void 0 ? {} : { renewalWaitMs: tuning.renewalWaitMs },
    ...tuning.keptAnswerTimeoutMs === void 0 ? {} : { keptAnswerTimeoutMs: tuning.keptAnswerTimeoutMs }
  });
  const control = createControl({
    key,
    table,
    tokens,
    identity,
    poller,
    log,
    now,
    pid: options.pid,
    port: options.port,
    startedAt: options.startedAt,
    onStopRequested: (request2) => {
      options.onStopRequested(request2);
    }
  });
  let closed = null;
  return {
    async start() {
      table.load();
      await tokens.prime(table.claudeLogins().map((login) => login.id));
      if (tuning.poll !== false) poller.start();
    },
    handle(req, res) {
      const kind = requestKind(req.method, req.url);
      switch (kind.kind) {
        case "hello":
          req.resume();
          res.writeHead(200, { "content-type": "application/json" }).end(req.method === "HEAD" ? void 0 : '{"message":"hello"}');
          return;
        case "control":
          void control.handle(req, res, kind.path);
          return;
        case "route":
          void proxy.handle(req, res);
          return;
        case "unknown":
          req.resume();
          res.writeHead(404).end();
      }
    },
    openRequests: () => proxy.openRequests(),
    drained: () => proxy.drained(),
    stopPolling() {
      poller.stopPolling();
    },
    close() {
      closed ??= (async () => {
        const probesEnded = poller.close();
        upstream.close();
        tokens.clear();
        await Promise.all([table.flush(), probesEnded]);
      })();
      return closed;
    }
  };
}

// src/daemon/main.ts
var DEFAULT_DRAIN_CAP_MS = 15 * 6e4;
var BIND_DEADLINE_MS = 1e4;
var BIND_RETRY_MS = 100;
var IDLE_CLOSE_INTERVAL_MS = 1e3;
var START_WAIT_MS = 1e4;
var CLOSE_WAIT_MS = 1e4;
var STOP_SIGNALS = ["SIGTERM", "SIGINT", "SIGHUP"];
var ERROR_EVENTS = ["uncaughtException", "unhandledRejection"];
async function runDaemon(options) {
  const version = options.version ?? kurmisVersion;
  const events = options.processEvents ?? process;
  const drainCapMs = options.drainCapMs ?? DEFAULT_DRAIN_CAP_MS;
  const bindDeadlineMs = options.bindDeadlineMs ?? BIND_DEADLINE_MS;
  const say = (text2) => {
    options.stdout?.write(`${text2}
`);
  };
  const complain = (text2) => {
    options.stderr?.write(`kurmis daemon: ${text2}
`);
  };
  const log = openDaemonLog();
  let key;
  let port;
  try {
    key = readOrCreateKey();
    port = loadConfig().port;
  } catch (error) {
    if (error instanceof ConfigError) {
      log.write("config_invalid", { reason: "invalid" });
      complain(error.message);
    } else {
      log.write("internal_error", { code: errorCodeOf(error) });
      complain(`could not read its files: ${messageOf4(error)}`);
    }
    return 1;
  }
  const stop2 = new StopControl();
  const onSignal = () => stop2.request("signal");
  const onError = (error) => {
    log.write("internal_error", { code: errorCodeOf(error) });
    stop2.request("error");
  };
  for (const signal of STOP_SIGNALS) events.on(signal, onSignal);
  for (const event of ERROR_EVENTS) events.on(event, onError);
  try {
    return await serve({ ...options, version, drainCapMs, bindDeadlineMs, key, port, log, stop: stop2, say, complain, onError });
  } finally {
    for (const signal of STOP_SIGNALS) events.off(signal, onSignal);
    for (const event of ERROR_EVENTS) events.off(event, onError);
  }
}
async function serve(options) {
  const { version, key, port, log, stop: stop2, say, complain } = options;
  const pid = process.pid;
  const startedAt = Date.now();
  let app;
  try {
    app = (options.createApp ?? createDaemonApp)({
      env: options.env,
      log,
      key,
      port,
      pid,
      startedAt,
      onStopRequested: (request2) => stop2.request("shutdown", request2.maxWaitMs)
    });
  } catch (error) {
    log.write("internal_error", { code: errorCodeOf(error) });
    complain(`could not set up its request handling: ${messageOf4(error)}`);
    return 1;
  }
  let started = null;
  let ready = false;
  const handle = (request2, response) => {
    try {
      app.handle(request2, response);
    } catch (error) {
      log.write("internal_error", { code: errorCodeOf(error) });
      if (!response.headersSent) response.statusCode = 500;
      response.end();
    }
  };
  const server = (0, import_node_http3.createServer)((request2, response) => {
    if (stop2.requested) response.setHeader("connection", "close");
    if (ready) {
      handle(request2, response);
      return;
    }
    void (started ?? Promise.resolve(false)).then((ok3) => {
      if (ok3) {
        handle(request2, response);
        return;
      }
      response.statusCode = 503;
      response.end();
    });
  });
  const bound = await bindPort(server, options);
  if (bound !== null) return bound;
  server.on("error", options.onError);
  if (!stop2.requested) {
    try {
      writeDaemonFile({ pid, port, version, startedAt });
    } catch (error) {
      log.write("internal_error", { code: errorCodeOf(error) });
      complain(`could not write daemon.json: ${messageOf4(error)}`);
      stop2.request("error");
    }
  }
  if (!stop2.requested) {
    log.write("daemon_started", { pid, port });
    say(`kurmis daemon ${version} runs on ${DAEMON_HOST}:${String(port)} (pid ${String(pid)})`);
    started = Promise.resolve().then(() => app.start()).then(
      () => {
        ready = true;
        return true;
      },
      (error) => {
        log.write("internal_error", { code: errorCodeOf(error) });
        complain(`could not start its request handling: ${messageOf4(error)}`);
        stop2.request("error");
        return false;
      }
    );
  }
  await stop2.firstRequest;
  log.write("daemon_stopping", { reason: stop2.reason ?? "other" });
  try {
    app.stopPolling();
  } catch (error) {
    log.write("internal_error", { code: errorCodeOf(error) });
  }
  server.close();
  server.closeIdleConnections();
  const idleTimer = setInterval(() => server.closeIdleConnections(), IDLE_CLOSE_INTERVAL_MS);
  try {
    if (stop2.exitCode === 0) await drain(app, options);
  } finally {
    clearInterval(idleTimer);
  }
  if (started !== null) {
    const outcome = await waitAtMost(started, START_WAIT_MS);
    if (outcome.kind === "done" && outcome.value) {
      const closed = await waitAtMost(Promise.resolve().then(() => app.close()), CLOSE_WAIT_MS);
      if (closed.kind === "failed") log.write("internal_error", { code: errorCodeOf(closed.error) });
      if (closed.kind === "timeout") log.write("internal_error", { reason: "timeout" });
    }
  }
  server.closeAllConnections();
  try {
    removeDaemonFile(pid);
  } catch (error) {
    log.write("internal_error", { code: errorCodeOf(error) });
  }
  log.write("daemon_stopped", { pid, ok: stop2.exitCode === 0 });
  say("kurmis daemon stopped");
  return stop2.exitCode;
}
async function drain(app, options) {
  if (app.openRequests() === 0) return;
  const outcome = await waitAtMost(app.drained(), options.drainCapMs, options.stop.drainSkipped);
  if (outcome.kind === "done" || outcome.kind === "failed") {
    if (outcome.kind === "failed") options.log.write("internal_error", { code: errorCodeOf(outcome.error) });
    return;
  }
  const reason = outcome.kind === "timeout" ? "timeout" : options.stop.skipReason ?? "signal";
  options.log.write("drain_cut_short", { count: app.openRequests(), reason });
}
async function bindPort(server, options) {
  const { version, key, port, log, stop: stop2, say, complain } = options;
  let deadline = Date.now() + options.bindDeadlineMs;
  let askedToStop = null;
  let lastHolder;
  for (; ; ) {
    if (stop2.requested) return stop2.exitCode;
    const error = await listenOnce(server, port);
    if (error === null) return null;
    if (error.code !== "EADDRINUSE") {
      const refused = error.code !== void 0 && UNUSABLE_PORT_CODES.has(error.code);
      log.write(refused ? "port_in_use" : "internal_error", { code: errorCodeOf(error), port });
      complain(refused ? unusablePortText(port, error.code ?? "", configPath()) : `could not listen on ${DAEMON_HOST}:${String(port)} (${error.code ?? error.message})`);
      return 1;
    }
    const holder = await portHolder(port, key);
    lastHolder = holder;
    if (holder.kind === "other" && askedToStop === null) {
      log.write("port_in_use", { port });
      complain(`port ${String(port)} on ${DAEMON_HOST} is used by another program. To use another port, set "port" in ${configPath()} to a number from ${String(MIN_PORT)} to ${String(MAX_PORT)}.`);
      return 1;
    }
    if (holder.kind === "kurmis") {
      const other = holder.status;
      if (!shouldReplace(other.version, version)) {
        say(`kurmis daemon ${other.version} already runs on port ${String(port)} (pid ${String(other.pid)})`);
        return 0;
      }
      if (askedToStop?.pid !== other.pid) {
        askedToStop = other;
        deadline = Date.now() + options.bindDeadlineMs;
        log.write("daemon_replacing_older", { pid: other.pid, port });
        say(`Replacing kurmis daemon ${other.version} (pid ${String(other.pid)}) on port ${String(port)}`);
        await controlRequest({ port, key, method: "POST", path: CONTROL_PATHS.stop });
      }
    }
    if (Date.now() >= deadline) {
      log.write("port_in_use", { port, reason: "timeout" });
      const seconds3 = String(Math.round(options.bindDeadlineMs / 1e3));
      complain(bindTimeoutText(port, seconds3, askedToStop, lastHolder ?? null));
      return 1;
    }
    await delay2(BIND_RETRY_MS);
  }
}
function bindTimeoutText(port, seconds3, askedToStop, lastHolder) {
  const where = `port ${String(port)} on ${DAEMON_HOST}`;
  if (askedToStop === null) return `${where} stayed busy for ${seconds3} s with nothing answering on it`;
  const old = `the kurmis daemon ${askedToStop.version} (pid ${String(askedToStop.pid)})`;
  if (lastHolder?.kind === "kurmis" && lastHolder.status.pid === askedToStop.pid) {
    return `${old} did not give up port ${String(port)} within ${seconds3} s`;
  }
  const answer2 = lastHolder?.kind === "other" ? ` (${lastHolder.reason})` : "";
  return `${old} was asked to stop, but ${where} stayed busy for ${seconds3} s, and what holds it now does not answer as that daemon${answer2}. Another program may have taken the port. To use another port, set "port" in ${configPath()} to a number from ${String(MIN_PORT)} to ${String(MAX_PORT)}.`;
}
var UNUSABLE_PORT_CODES = /* @__PURE__ */ new Set(["EACCES", "EADDRNOTAVAIL"]);
function unusablePortText(port, code, configFile) {
  return `could not listen on ${DAEMON_HOST}:${String(port)} (${code}): the system does not let this program use the port. On Windows a port inside a range the system reserves is refused this way; "netsh int ipv4 show excludedportrange protocol=tcp" lists those ranges. To use another port, set "port" in ${configFile} to a number from ${String(MIN_PORT)} to ${String(MAX_PORT)} outside them.`;
}
function listenOnce(server, port) {
  return new Promise((resolve8) => {
    const onError = (error) => {
      server.off("listening", onListening);
      resolve8(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve8(null);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, DAEMON_HOST);
  });
}
var StopControl = class {
  requested = false;
  reason = null;
  skipReason = null;
  exitCode = 0;
  firstRequest;
  drainSkipped;
  resolveFirst;
  resolveSkip;
  constructor() {
    this.firstRequest = new Promise((resolve8) => {
      this.resolveFirst = resolve8;
    });
    this.drainSkipped = new Promise((resolve8) => {
      this.resolveSkip = resolve8;
    });
  }
  request(reason, maxWaitMs) {
    if (reason === "error") this.exitCode = 1;
    if (maxWaitMs !== void 0) {
      setTimeout(() => this.skip("timeout"), Math.max(0, maxWaitMs)).unref();
    }
    if (!this.requested) {
      this.requested = true;
      this.reason = reason;
      this.resolveFirst();
      if (reason === "error") this.skip(reason);
      return;
    }
    if (reason === "signal" || reason === "error") this.skip(reason);
  }
  skip(reason) {
    this.skipReason ??= reason;
    this.resolveSkip();
  }
};
function waitAtMost(promise, ms, skip) {
  return new Promise((resolve8) => {
    const timer = setTimeout(() => resolve8({ kind: "timeout" }), ms);
    const finish = (outcome) => {
      clearTimeout(timer);
      resolve8(outcome);
    };
    promise.then((value) => finish({ kind: "done", value }), (error) => finish({ kind: "failed", error }));
    void skip?.then(() => finish({ kind: "skipped" }));
  });
}
function messageOf4(error) {
  return error instanceof Error ? error.message : String(error);
}

// src/platform/launchd.ts
var import_node_os12 = require("node:os");
var import_node_path19 = require("node:path");
var LAUNCHCTL_PROGRAM = realSystemProgram("launchctl");
var LAUNCHCTL_VARIABLE = SYSTEM_PROGRAM_VARIABLES.launchctl;
var LAUNCHCTL_TIMEOUT_MS = 3e4;
var AUTOSTART_LABEL = "kurmis.daemon";
var DAEMON_START_ARGS = ["daemon", "start"];
function launchctlProgram(env = process.env, processEnv = process.env) {
  return systemProgram("launchctl", env, processEnv);
}
function launchctlFor(env = process.env) {
  const program = launchctlProgram(env);
  return (args) => runProgram(program, args, { timeoutMs: LAUNCHCTL_TIMEOUT_MS, env });
}
function currentUid() {
  return typeof process.getuid === "function" ? process.getuid() : 0;
}
function guiDomain(uid = currentUid()) {
  return `gui/${String(uid)}`;
}
function launchAgentsDir() {
  return (0, import_node_path19.join)((0, import_node_os12.homedir)(), "Library", "LaunchAgents");
}
function autostartPlistPath() {
  return (0, import_node_path19.join)(launchAgentsDir(), `${AUTOSTART_LABEL}.plist`);
}
function escapeXml(text2) {
  return text2.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function plistXml(root) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>"
  ];
  const string = (value) => `<string>${escapeXml(value)}</string>`;
  const scalar2 = (value) => typeof value === "boolean" ? value ? "<true/>" : "<false/>" : string(value);
  for (const [key, value] of Object.entries(root)) {
    lines.push(`  <key>${escapeXml(key)}</key>`);
    if (typeof value === "string" || typeof value === "boolean") lines.push(`  ${scalar2(value)}`);
    else if (Array.isArray(value)) lines.push("  <array>", ...value.map((item) => `    ${string(item)}`), "  </array>");
    else {
      lines.push("  <dict>");
      for (const [name, item] of Object.entries(value)) {
        lines.push(`    <key>${escapeXml(name)}</key>`, `    ${scalar2(item)}`);
      }
      lines.push("  </dict>");
    }
  }
  lines.push("</dict>", "</plist>", "");
  return lines.join("\n");
}
var DAEMON_JOB_VARIABLES = [
  "KURMIS_HOME",
  "KURMIS_CLAUDE_BIN",
  "KURMIS_CODEX_BIN",
  "KURMIS_UPSTREAM_URL",
  "KURMIS_SECURITY_PROGRAM",
  "KURMIS_ENTRY",
  ...Object.values(SYSTEM_PROGRAM_VARIABLES).filter((name) => name !== "KURMIS_SECURITY_PROGRAM"),
  GUARD_VARIABLE,
  REFUSAL_LOG_VARIABLE
];
var FALLBACK_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
function daemonJobEnvironment(env = process.env, processEnv = process.env) {
  const out = {
    HOME: env.HOME !== void 0 && env.HOME !== "" ? env.HOME : (0, import_node_os12.homedir)(),
    PATH: env.PATH !== void 0 && env.PATH !== "" ? env.PATH : FALLBACK_PATH
  };
  const hooks = inheritedTestHooks(env, processEnv);
  for (const name of DAEMON_JOB_VARIABLES) {
    const value = env[name] || hooks[name];
    if (value === void 0 || value === "") continue;
    out[name] = name === "KURMIS_HOME" ? (0, import_node_path19.resolve)(value) : value;
  }
  return out;
}
function daemonJobPlist(job) {
  return plistXml({
    Label: job.label,
    ProgramArguments: job.programArguments,
    EnvironmentVariables: job.environment,
    WorkingDirectory: job.environment.HOME ?? (0, import_node_os12.homedir)(),
    RunAtLoad: true,
    AbandonProcessGroup: true,
    StandardOutPath: "/dev/null",
    StandardErrorPath: "/dev/null"
  });
}
function parseLaunchctlPrint(result) {
  if (result.code !== 0) return { loaded: false, path: null };
  const path = /^\tpath = (.*)$/m.exec(result.stdout);
  return { loaded: true, path: path === null ? null : (path[1] ?? "").trim() };
}
async function jobState(label, launchctl = launchctlFor(), uid) {
  return parseLaunchctlPrint(await launchctl(["print", `${guiDomain(uid)}/${label}`]));
}
function launchctlSaid(result) {
  if (result.error !== null) return result.error;
  const said = `${result.stderr}
${result.stdout}`.replace(/\s+/g, " ").trim();
  return said === "" ? `exit ${String(result.code)}` : `exit ${String(result.code)}: ${said}`;
}
function isNotLoaded(result) {
  if (result.code === 3 || result.code === 113) return true;
  return /no such process|could not find (specified )?service/i.test(`${result.stderr}
${result.stdout}`);
}
function isMissingGuiDomain(result) {
  if (result.code === 125 || result.code === 112) return true;
  return /domain does not support specified action|could not find domain/i.test(`${result.stderr}
${result.stdout}`);
}
function bootstrapFailure(result, domain) {
  const said = launchctlSaid(result);
  if (result.error === null && isMissingGuiDomain(result)) {
    return `launchd could not load the job into ${domain} (${said}). This usually means nobody is logged in at this Mac's screen: the GUI session, the only one that can read the login Keychain, exists only while you are logged in there or through Screen Sharing.`;
  }
  return `launchd could not load the job into ${domain} (${said}).`;
}
async function bootstrapJob(plistPath, launchctl = launchctlFor(), uid) {
  const domain = guiDomain(uid);
  const result = await launchctl(["bootstrap", domain, plistPath]);
  if (result.code !== 0 || result.error !== null) throw new Error(bootstrapFailure(result, domain));
}
async function bootoutJob(label, launchctl = launchctlFor(), uid) {
  const target = `${guiDomain(uid)}/${label}`;
  const result = await launchctl(["bootout", target]);
  if (result.code === 0 && result.error === null) return true;
  if (result.error === null && isNotLoaded(result)) return false;
  throw new Error(`launchd could not unload ${target} (${launchctlSaid(result)}).`);
}

// src/cli/commands/daemon.ts
var RUN_EXIT_FALLBACK_MS = 2e3;
function clientOptions(context) {
  return { env: context.env };
}
function failed(error, context) {
  if (!(error instanceof DaemonError)) throw error;
  writeLine(context.stderr, `kurmis daemon: ${error.message}`);
  return EXIT_FAILURE;
}
function address(port) {
  return `127.0.0.1:${String(port)}`;
}
function describeStart(result) {
  const { connection } = result;
  const where = `on ${address(connection.port)} (pid ${String(connection.pid)})`;
  if (!result.started) {
    const newer = compareVersions(connection.version, kurmisVersion) === 1;
    return newer ? `A newer kurmis daemon (${connection.version}) already runs ${where}; this kurmis is ${kurmisVersion}.` : `The kurmis daemon ${connection.version} already runs ${where}.`;
  }
  const replaced = result.replaced === null ? "" : `, replacing version ${result.replaced}, which stops once its open requests finish`;
  return `Started the kurmis daemon ${connection.version} ${where}${replaced}.`;
}
var start = async (args, context) => {
  const parsed = parseCommandArgs("daemon start", args, { env: { type: "string", multiple: true } }, context);
  if (typeof parsed === "number") return parsed;
  const assignments = daemonStartAssignments(parsed.values.env ?? []);
  if (typeof assignments === "string") return usageError("daemon start", assignments, context);
  for (const [name, value] of Object.entries(assignments)) process.env[name] = value;
  const startContext = { ...context, env: { ...context.env, ...assignments } };
  try {
    writeLine(context.stdout, describeStart(await startDaemon(clientOptions(startContext))));
    return EXIT_OK;
  } catch (error) {
    return failed(error, context);
  }
};
var restart = async (args, context) => {
  const parsed = parseCommandArgs("daemon restart", args, {}, context);
  if (typeof parsed === "number") return parsed;
  try {
    writeLine(context.stdout, describeStart(await restartDaemon(clientOptions(context))));
    return EXIT_OK;
  } catch (error) {
    return failed(error, context);
  }
};
var stop = async (args, context) => {
  const parsed = parseCommandArgs("daemon stop", args, { now: { type: "boolean" } }, context);
  if (typeof parsed === "number") return parsed;
  const now = parsed.values.now === true;
  try {
    const found = await findDaemon(clientOptions(context));
    if (found === null) {
      const problem = await keyRefusedProblem(clientOptions(context));
      if (problem !== null) throw new DaemonError(problem);
    }
    if (found === null || !await stopDaemon({ ...clientOptions(context), now })) {
      writeLine(context.stdout, "The kurmis daemon is not running.");
      const silent = found === null ? silentDaemon() : null;
      if (silent !== null) {
        writeLine(context.stdout, `Process ${String(silent.pid)}, named in daemon.json, does not answer on ${address(silent.port)}, so it was not asked to stop. It may be finishing its open requests before it stops.`);
      }
    } else {
      writeLine(context.stdout, now ? `Stopped the kurmis daemon (pid ${String(found.pid)}) without waiting for its open requests.` : `Stopped the kurmis daemon (pid ${String(found.pid)}).`);
    }
    return EXIT_OK;
  } catch (error) {
    return failed(error, context);
  }
};
var status = async (args, context) => {
  const parsed = parseCommandArgs("daemon status", args, { json: { type: "boolean" } }, context);
  if (typeof parsed === "number") return parsed;
  const json = parsed.values.json === true;
  try {
    const found = await findDaemon(clientOptions(context));
    if (found === null) {
      const silent = silentDaemon();
      const refused = silent === null ? null : await keyRefusedProblem(clientOptions(context));
      if (json) {
        writeLine(context.stdout, JSON.stringify({
          running: false,
          cliVersion: kurmisVersion,
          ...silent === null ? {} : { notAnswering: silent },
          ...refused === null ? {} : { keyRefused: refused }
        }, null, 2));
      } else {
        writeLine(context.stdout, "The kurmis daemon is not running.");
        if (refused !== null) {
          writeLine(context.stdout, refused);
        } else if (silent !== null) {
          writeLine(context.stdout, `Process ${String(silent.pid)}, named in daemon.json, does not answer on ${address(silent.port)}. It may be finishing its open requests before it stops.`);
        }
      }
      return EXIT_FAILURE;
    }
    const answer2 = await readStatus3(found);
    if (json) {
      writeLine(context.stdout, JSON.stringify({
        running: true,
        pid: answer2.pid,
        port: answer2.port,
        version: answer2.version,
        apiVersion: answer2.apiVersion,
        startedAt: answer2.startedAt,
        logins: answer2.logins.length,
        cliVersion: kurmisVersion
      }, null, 2));
      return EXIT_OK;
    }
    writeLine(context.stdout, `The kurmis daemon ${answer2.version} runs on ${address(answer2.port)}, pid ${String(answer2.pid)}, since ${new Date(answer2.startedAt).toISOString()}, with ${String(answer2.logins.length)} logins.`);
    const order = compareVersions(answer2.version, kurmisVersion);
    if (order === -1) writeLine(context.stdout, `This kurmis is ${kurmisVersion}; the next kurmis command replaces the daemon.`);
    if (order === 1) writeLine(context.stdout, `This kurmis is ${kurmisVersion}, older than the daemon.`);
    return EXIT_OK;
  } catch (error) {
    return failed(error, context);
  }
};
function daemonStartAssignments(values) {
  const out = {};
  for (const value of values) {
    const at2 = value.indexOf("=");
    const name = at2 === -1 ? value : value.slice(0, at2);
    if (at2 === -1 || !DAEMON_JOB_VARIABLES.includes(name)) {
      return `--env takes NAME=VALUE with NAME one of ${DAEMON_JOB_VARIABLES.join(", ")}, not "${name}"`;
    }
    out[name] = value.slice(at2 + 1);
  }
  return out;
}
var run = async (args, context) => {
  const parsed = parseCommandArgs("daemon run", args, {}, context);
  if (typeof parsed === "number") return parsed;
  const code = await runDaemon({ env: context.env, stdout: context.stdout, stderr: context.stderr });
  setTimeout(() => process.exit(code), RUN_EXIT_FALLBACK_MS).unref();
  return code;
};
var SUBCOMMANDS = { start, stop, restart, status, run };
var daemonCommand = {
  name: "daemon",
  summary: "Start, stop or show the background process",
  usage: `Usage: kurmis daemon <start|stop|restart|status|run>

The daemon is the background process that routes Claude requests. "kurmis claude" starts it
when it is not running, so it seldom needs starting by hand.

  start                   Start it in the background, replacing one of an older version.
                          --env NAME=VALUE sets a kurmis variable in the daemon's
                          environment; the Windows logon entry uses it.
  stop [--now]            Stop it after it finishes the requests it has open, waiting at most
                          30 seconds for them. With --now it stops at once and cuts the
                          requests it has open. An open Claude session then sees a dropped
                          connection and retries the request.
  restart                 Start a new one now; the old one finishes its open requests first.
  status [--json]         Show whether it runs, its pid, port and version. Exits 1 when it
                          does not run.
  run                     Run it in this terminal instead of the background (what "start"
                          launches).

On macOS, a daemon started from an ssh login cannot read the login Keychain. Run "kurmis
setup" in a terminal at the screen: the daemon then runs in your desktop session, starts
again at each login, and ssh sessions use it.

Options:
  -h, --help              Show this help.`,
  run(args, context) {
    const [subcommand, ...rest] = args;
    if (subcommand === void 0) return usageError("daemon", "needs one of start, stop, restart, status, run", context);
    const handler = Object.hasOwn(SUBCOMMANDS, subcommand) ? SUBCOMMANDS[subcommand] : void 0;
    if (handler === void 0) return usageError("daemon", `unknown subcommand "${subcommand}"`, context);
    return handler(rest, context);
  }
};

// src/cli/commands/list.ts
var import_node_fs17 = require("node:fs");
var import_node_os13 = require("node:os");
var import_node_path20 = require("node:path");
var CODEX_LOGIN_STATUS_TIMEOUT_MS = 1e4;
function namesAccount(file) {
  try {
    return parseClaudeIdentity((0, import_node_fs17.readFileSync)(file, "utf8")) !== null;
  } catch {
    return false;
  }
}
function hasLocalCredentials(login, env, home) {
  if (login.provider === "codex") return (0, import_node_fs17.existsSync)((0, import_node_path20.join)(codexHomeOf(login, env, home), "auth.json"));
  if (login.machineOwn) {
    return (0, import_node_fs17.existsSync)((0, import_node_path20.join)(home, ".claude", ".credentials.json")) || namesAccount((0, import_node_path20.join)(home, CLAUDE_PROFILE_FILE));
  }
  const folder = loginFolder(login);
  return (0, import_node_fs17.existsSync)((0, import_node_path20.join)(folder, ".credentials.json")) || namesAccount((0, import_node_path20.join)(folder, CLAUDE_PROFILE_FILE));
}
function codexHomeOf(login, env, home, platform = process.platform) {
  const patched = applyEnvPatch(env, codexLoginEnv(login, env, platform), platform === "win32");
  const named = platform === "win32" ? windowsEnv(patched, "CODEX_HOME") : patched["CODEX_HOME"];
  return named !== void 0 && named !== "" ? named : (0, import_node_path20.join)(home, ".codex");
}
function codexKeepsSignInElsewhere(codexHome) {
  let text2;
  try {
    text2 = (0, import_node_fs17.readFileSync)((0, import_node_path20.join)(codexHome, "config.toml"), "utf8");
  } catch {
    return false;
  }
  try {
    const store = tomlValue(text2)["cli_auth_credentials_store"];
    return store !== void 0 && store !== "file";
  } catch {
    return true;
  }
}
async function codexSignedIn2(login, env, deps) {
  let program;
  try {
    program = deps.findProgram("codex", { env });
  } catch (error) {
    if (error instanceof ProgramNotFoundError) return false;
    throw error;
  }
  const result = await deps.runProgram(
    program.command,
    [...program.args, "login", "status"],
    { timeoutMs: CODEX_LOGIN_STATUS_TIMEOUT_MS, env: applyEnvPatch(env, codexLoginEnv(login, env)), maxOutputBytes: 64 * 1024 }
  );
  return result.code === 0;
}
async function hasCredentials(login, env, home, deps) {
  if (hasLocalCredentials(login, env, home)) return true;
  if (login.provider !== "codex" || !codexKeepsSignInElsewhere(codexHomeOf(login, env, home))) return false;
  return await codexSignedIn2(login, env, deps);
}
var HEADER = ["PROVIDER", "ALIAS", "ID", "AUTO", "FIVE-HOUR", "WEEKLY", "USE-FIRST", "CREDENTIALS"];
function formatLoginTable(logins) {
  const rows = [
    HEADER,
    ...logins.map((login) => [
      login.provider,
      login.alias,
      login.id,
      login.routing ? "on" : "off",
      `${String(login.fiveHourLimit)}%`,
      `${String(login.weeklyLimit)}%`,
      login.useFirst ? "on" : "off",
      login.credentials ? "yes" : "no"
    ])
  ];
  const widths = HEADER.map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  const table = rows.map((row) => row.map((cell, column) => cell.padEnd(widths[column])).join("  ").trimEnd());
  const own2 = logins.filter((login) => login.machineOwn).map((login) => `${login.alias} is ${machineOwnText(login.provider)}.`);
  return [...table, ...own2.length > 0 ? ["", ...own2] : []].join("\n");
}
function createListCommand(deps = {}) {
  const home = deps.home ?? import_node_os13.homedir;
  const codex = { findProgram: deps.findProgram ?? realFindProgram, runProgram: deps.runProgram ?? runProgram };
  return {
    name: "list",
    summary: "List the logins and their routing settings",
    usage: `Usage: kurmis list [--json]

Lists every login kurmis knows, with its settings and whether it has credentials on this
machine. The logins of plain claude and plain codex come first. They are the accounts a plain
"claude" and a plain "codex" are signed in to, and the lines under the table name them.
Change the settings with "kurmis set". The columns:

  PROVIDER      claude or codex.
  ALIAS         The name you type for the login, for example in "kurmis claude --login".
                Kurmis makes it from the account's email until you set one with
                "kurmis set <alias> --alias <new alias>". While kurmis knows no email for
                the login, the alias is its id.
  ID            The login's id, which never changes. Commands take it in place of the alias.
  AUTO          Whether Auto routing may use the login (set --auto).
  FIVE-HOUR     Auto routing stops using the login once its five-hour window reaches this
                (set --five-hour).
  WEEKLY        The same for the weekly window (set --weekly).
  USE-FIRST     Whether Auto routing takes this login before the others that have room
                (set --use-first).
  CREDENTIALS   Whether the login's credentials are on this machine. This looks at files, and
                asks "codex login status" for a Codex login that keeps its sign-in in the
                system's keyring (cli_auth_credentials_store); "kurmis status" asks the daemon
                whether they still work.

Options:
  --json       Print the logins as JSON. Each has "alias", "id", "provider", "machineOwn"
               (true for the logins of plain claude and plain codex) and "credentials" for the last column.
  -h, --help   Show this help.`,
    async run(args, context) {
      const parsed = parseCommandArgs("list", args, { json: { type: "boolean" } }, context);
      if (typeof parsed === "number") return parsed;
      let logins;
      try {
        logins = loadConfig().logins;
      } catch (error) {
        if (!(error instanceof ConfigError)) throw error;
        writeLine(context.stderr, `kurmis list: ${error.message}`);
        return EXIT_FAILURE;
      }
      const listed = await Promise.all(logins.map(async (login) => ({ ...login, credentials: await hasCredentials(login, context.env, home(), codex) })));
      writeLine(context.stdout, parsed.values.json === true ? JSON.stringify(listed, null, 2) : formatLoginTable(listed));
      return EXIT_OK;
    }
  };
}
var listCommand = createListCommand();

// src/cli/commands/login.ts
var import_node_fs19 = require("node:fs");
var import_node_os14 = require("node:os");
var import_node_path22 = require("node:path");

// src/platform/remove-tree.ts
var import_node_fs18 = require("node:fs");
var import_node_path21 = require("node:path");
var nodeFs = {
  lstatSync: (path) => (0, import_node_fs18.lstatSync)(path),
  readdirSync: (path) => (0, import_node_fs18.readdirSync)(path),
  unlinkSync: (path) => (0, import_node_fs18.unlinkSync)(path),
  rmdirSync: (path) => (0, import_node_fs18.rmdirSync)(path),
  chmodSync: (path, mode) => (0, import_node_fs18.chmodSync)(path, mode),
  realpathSync: (path) => import_node_fs18.realpathSync.native(path)
};
function codeOf2(error) {
  return error?.code;
}
function removeTreeSync(path, options = {}) {
  removeEntry2(path, options.fs ?? nodeFs, options.platform ?? process.platform, null);
}
function insideWindowsFolder(path, root) {
  const a = import_node_path21.win32.normalize(path).replace(/^\\\\\?\\/, "").toLowerCase();
  const b = import_node_path21.win32.normalize(root).replace(/^\\\\\?\\/, "").replace(/\\+$/, "").toLowerCase();
  return a === b || a.startsWith(`${b}\\`);
}
function removeEntry2(path, fs, platform, root) {
  let stat2;
  try {
    stat2 = fs.lstatSync(path);
  } catch (error) {
    if (codeOf2(error) === "ENOENT") return;
    throw error;
  }
  if (stat2.isSymbolicLink()) {
    removeLink(path, fs, platform);
  } else if (stat2.isDirectory()) {
    let inside = root;
    if (platform === "win32") {
      let real;
      try {
        real = fs.realpathSync(path);
      } catch {
        real = null;
      }
      if (real === null || root !== null && !insideWindowsFolder(real, root)) {
        retryWhileLockedSync(() => fs.rmdirSync(path), platform);
        return;
      }
      inside = root ?? real;
    }
    for (const name of fs.readdirSync(path)) removeEntry2((0, import_node_path21.join)(path, name), fs, platform, inside);
    retryWhileLockedSync(() => fs.rmdirSync(path), platform);
  } else {
    removeFile2(path, fs, platform);
  }
}
function removeLink(path, fs, platform) {
  if (platform !== "win32") {
    fs.unlinkSync(path);
    return;
  }
  try {
    fs.unlinkSync(path);
  } catch (error) {
    const code = codeOf2(error);
    if (code !== "EPERM" && code !== "EISDIR" && code !== "EACCES" && code !== "EBUSY") throw error;
    retryWhileLockedSync(() => fs.rmdirSync(path), platform);
  }
}
function removeFile2(path, fs, platform) {
  if (platform !== "win32") {
    fs.unlinkSync(path);
    return;
  }
  try {
    fs.unlinkSync(path);
  } catch (error) {
    const code = codeOf2(error);
    if (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY") throw error;
    if (code === "EPERM") fs.chmodSync(path, 438);
    retryWhileLockedSync(() => fs.unlinkSync(path), platform);
  }
}

// src/cli/login-lock.ts
var LOGIN_LOCK_STALE_MS = 24 * 60 * 60 * 1e3;
var LOGIN_LOCK_WAIT_MS = 500;
var LoginBusyError = class extends Error {
  constructor(id, path, pid, name = id) {
    super(`another "kurmis login" or "kurmis logout" of ${name} is running now${pid === null ? "" : ` (pid ${String(pid)})`}. Wait for it to end and try again. If none is running, delete ${path}.`);
    this.id = id;
    this.path = path;
    this.name = "LoginBusyError";
  }
  id;
  path;
};
function lockLogin(id, name = id) {
  const path = loginLockPath(id);
  try {
    return acquireFileLockSync(path, { timeoutMs: LOGIN_LOCK_WAIT_MS, staleMs: LOGIN_LOCK_STALE_MS });
  } catch (error) {
    if (error instanceof LockTimeoutError) throw new LoginBusyError(id, path, error.holder?.pid ?? null, name);
    throw error;
  }
}

// src/cli/sign-out.ts
var LOGOUT_TIMEOUT_MS = 3e4;
async function signOutLogin(login, env, deps) {
  const cliName = login.provider === "claude" ? "claude auth logout" : "codex logout";
  let problem;
  try {
    const program = deps.findProgram(login.provider, { env });
    const patch = login.provider === "claude" ? claudeLoginEnv(login, deps.platform === "win32") : codexLoginEnv(login, env);
    const cliArgs = login.provider === "claude" ? ["auth", "logout"] : ["logout"];
    const result = await deps.runProgram(
      program.command,
      [...program.args, ...cliArgs],
      { timeoutMs: LOGOUT_TIMEOUT_MS, env: applyEnvPatch(env, patch) }
    );
    if (result.code === 0) return null;
    problem = result.error ?? `exit code ${String(result.code)}`;
  } catch (error) {
    if (!(error instanceof ProgramNotFoundError)) throw error;
    problem = error.message;
  }
  return `"${cliName}" did not finish (${problem})`;
}
function leftBehindText(login, platform) {
  if (login.provider !== "claude") return "";
  const service = keychainService(loginFolder(login));
  if (platform === "darwin") return ` Its Keychain item "${service}" may be left; Keychain Access can delete it.`;
  if (platform === "win32") return ` Its Windows credentials "${service}/\u2026" may be left; Credential Manager can delete them.`;
  return "";
}

// src/cli/commands/login.ts
var LOGIN_PROBE_WAIT_MS = 15e3;
function loginTarget(argument, config) {
  if (isLoginProvider(argument)) return { kind: "new", provider: argument };
  const resolved = resolveLogin(config, argument);
  if ("error" in resolved) {
    return { error: `${resolved.error}. "kurmis login claude" or "kurmis login codex" adds a new login, and "kurmis list" shows the logins there are` };
  }
  return { kind: "existing", login: resolved.login };
}
function freshLoginId(config) {
  for (; ; ) {
    const id = newLoginIdFor(config);
    if (LOGIN_PROVIDERS.every((provider) => !(0, import_node_fs19.existsSync)(loginFolder({ id, provider, machineOwn: false })))) return id;
  }
}
function homeIdentity(home) {
  try {
    return parseClaudeIdentity((0, import_node_fs19.readFileSync)((0, import_node_path22.join)(home, CLAUDE_PROFILE_FILE), "utf8"));
  } catch {
    return null;
  }
}
function fail2(context, message) {
  writeLine(context.stderr, `kurmis login: ${message}`);
  return EXIT_FAILURE;
}
function sameEmail(a, b) {
  return a !== null && b !== null && a.trim().toLowerCase() === b.trim().toLowerCase();
}
async function sameAccount(config, login, email, env, deps) {
  const others = config.logins.filter((other) => other.provider === login.provider && other.id !== login.id);
  if (login.provider === "claude") {
    return others.find((other) => sameEmail(readClaudeIdentity(other, deps.home())?.email ?? null, email)) ?? null;
  }
  const known = /* @__PURE__ */ new Map();
  try {
    const connection = await deps.daemon.findDaemon({ env });
    if (connection !== null) {
      for (const row of (await deps.daemon.readStatus(connection)).logins) if (row.email !== null) known.set(row.id, row.email);
    }
  } catch {
  }
  const emails = await Promise.all(others.map(async (other) => known.get(other.id) ?? await deps.readCodexEmail(other, env)));
  return others.find((_, index) => sameEmail(emails[index] ?? null, email)) ?? null;
}
async function tellDaemon(daemon, login, env, probeWaitMs) {
  let connection;
  try {
    connection = await daemon.findDaemon({ env });
    if (connection === null) return [];
    await daemon.requestReload(connection);
  } catch (error) {
    const said = reloadText({ kind: "failed", message: error instanceof Error ? error.message : String(error) });
    return said === null ? [] : [said];
  }
  const lines = [reloadText({ kind: "reloaded" }) ?? ""];
  const found = connection;
  const probed = await settleWithin((signal) => daemon.requestProbe(found, [login.id], signal), probeWaitMs);
  if (probed.kind === "done") {
    const row = probed.value.logins.find((other) => other.id === login.id);
    if (row?.signedIn === false) lines.push(`The daemon still finds ${login.alias} signed out; "kurmis status" shows what it knows.`);
  } else {
    const why = probed.kind === "timeout" ? `did not finish within ${String(probeWaitMs / 1e3)} s` : `failed (${probed.error instanceof Error ? probed.error.message : String(probed.error)})`;
    lines.push(`The daemon's check of ${login.alias} ${why}; it checks the login again within 15 minutes.`);
  }
  return lines;
}
async function signIn(run2) {
  const { ref, isNew, name, lock, program, alias, context, deps } = run2;
  const provider = ref.provider;
  const folder = ref.machineOwn ? null : loginFolder(ref);
  let created = false;
  if (folder !== null && !(0, import_node_fs19.existsSync)(folder)) {
    makePrivateDirSync(folder);
    created = true;
  }
  const cleanUp = () => {
    if (!created || folder === null) return;
    removeTreeSync(folder);
    if (provider === "codex") (0, import_node_fs19.rmSync)(codexMergedRecordPath(ref), { force: true });
  };
  const notAdded = isNew ? " No login was added." : "";
  if (provider === "codex" && !ref.machineOwn) {
    try {
      const prepared = await deps.prepareCodexHome({ ...ref, alias: name }, { env: context.env });
      for (const warning of prepared.warnings) writeLine(context.stderr, `kurmis login: ${warning}`);
    } catch (error) {
      cleanUp();
      return fail2(context, `could not prepare the Codex home of ${name}: ${error instanceof Error ? error.message : String(error)}.${notAdded}`);
    }
  }
  const cliName = provider === "claude" ? "claude auth login" : "codex login";
  const what = isNew ? `a new ${PROVIDER_NAMES2[provider]} login (id ${ref.id})` : name;
  writeLine(context.stdout, `Signing in ${what} with "${cliName}". Follow its steps.`);
  const credentialManager = provider === "claude" && await deps.inCredentialManager(folder, context.env);
  const env = applyEnvPatch(context.env, provider === "claude" ? claudeLoginEnv(ref, credentialManager) : codexLoginEnv(ref, context.env));
  const cliArgs = provider === "claude" ? ["auth", "login", "--claudeai"] : ["login"];
  const end = await deps.runner.runInteractive({ command: program.command, args: [...program.args, ...cliArgs], env });
  if (end.kind !== "exit") {
    cleanUp();
    lock.release();
    if (isNew) writeLine(context.stderr, `kurmis login:${notAdded}`);
    return deps.runner.finishLikeChild(end, { stderr: context.stderr, name: provider });
  }
  if (end.code !== 0) {
    cleanUp();
    return fail2(context, `"${cliName}" failed (exit code ${String(end.code)}).${notAdded}`);
  }
  if (provider === "claude" && ref.machineOwn) {
    (0, import_node_fs19.rmSync)((0, import_node_path22.join)(ownClaudeProbeFolder(), CLAUDE_PROFILE_FILE), { force: true });
  }
  const identity = provider === "claude" ? ref.machineOwn ? homeIdentity(deps.home()) : readClaudeIdentity(ref, deps.home()) : null;
  if (identity === null && !await hasCredentials(ref, context.env, deps.home(), deps)) {
    cleanUp();
    return fail2(context, `"${cliName}" ended, but ${name} has no credentials.${notAdded}`);
  }
  const email = provider === "claude" ? identity?.email ?? null : await deps.readCodexEmail(ref, context.env);
  if (isNew && email !== null) {
    let config;
    try {
      config = loadConfig();
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error;
      return fail2(context, `${name} is signed in, but config.json could not be read: ${error.message} "kurmis logout ${ref.id}" removes its credentials and folder.`);
    }
    const existing = await sameAccount(config, ref, email, context.env, deps);
    if (existing !== null) return await dropDuplicate(run2, config, existing, email);
  }
  let saved;
  try {
    saved = changeConfig((config) => {
      let next = isNew ? addLogin(config, ref, alias === void 0 ? {} : { alias }) : config;
      if (!isNew && alias !== void 0) next = updateLogin(next, ref.id, { alias });
      return followEmail(next, ref.id, email);
    });
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    return fail2(context, isNew ? `${name} is signed in but could not be added: ${error.message} "kurmis logout ${ref.id}" removes its credentials and folder.` : `${name} is signed in again but its settings could not be saved: ${error.message}`);
  }
  const login = findLogin(saved, ref.id);
  const argument = loginArgument(saved, login);
  writeLine(context.stdout, email === null ? "Signed in." : `Signed in as ${email}.`);
  if (isNew) {
    writeLine(context.stdout, `Added ${login.alias} (id ${login.id}), a ${PROVIDER_NAMES2[provider]} login with Auto routing on and both limits at 100%. "kurmis set ${argument}" changes that.`);
  } else if (login.alias !== name) {
    writeLine(context.stdout, `${name} is now called ${login.alias}.`);
  }
  for (const line of await tellDaemon(deps.daemon, login, context.env, deps.probeWaitMs)) writeLine(context.stdout, line);
  return EXIT_OK;
}
async function dropDuplicate(run2, config, existing, email) {
  const { ref, context, deps } = run2;
  const problem = await signOutLogin(ref, context.env, deps);
  if (problem !== null) {
    writeLine(context.stderr, `kurmis login: ${problem}; the new sign-in is deleted anyway.${leftBehindText(ref, deps.platform)}`);
  }
  try {
    removeTreeSync(loginFolder(ref));
    if (ref.provider === "codex") (0, import_node_fs19.rmSync)(codexMergedRecordPath(ref), { force: true });
  } catch (error) {
    return fail2(context, `${email} is already ${existing.alias}, but the folder of the new sign-in could not be deleted (${error instanceof Error ? error.message : String(error)}). "kurmis logout ${ref.id}" deletes it.`);
  }
  const which = existing.machineOwn ? `${existing.alias}, ${machineOwnText(existing.provider)}` : existing.alias;
  writeLine(context.stdout, `${email} is already a kurmis ${PROVIDER_NAMES2[ref.provider]} login: ${which} (id ${existing.id}). No login was added, and the new sign-in was signed out again.`);
  writeLine(context.stdout, `"kurmis login ${loginArgument(config, existing)}" signs ${existing.alias} in again.`);
  return EXIT_OK;
}
function createLoginCommand(deps = {}) {
  const full = {
    daemon: deps.daemon ?? realDaemonClient,
    runner: deps.runner ?? realChildRunner,
    findProgram: deps.findProgram ?? realFindProgram,
    runProgram: deps.runProgram ?? runProgram,
    home: deps.home ?? import_node_os14.homedir,
    prepareCodexHome: deps.prepareCodexHome ?? realPrepareCodexHome,
    probeWaitMs: deps.probeWaitMs ?? LOGIN_PROBE_WAIT_MS,
    inCredentialManager: deps.inCredentialManager ?? ((folder, env) => holdsStoredRecord(folder, env)),
    readCodexEmail: deps.readCodexEmail ?? ((login, env) => readCodexEmail(login, { env })),
    platform: deps.platform ?? process.platform
  };
  return {
    name: "login",
    summary: "Sign in a new login, or sign an existing one in again",
    usage: `Usage: kurmis login claude|codex [--alias <alias>]
       kurmis login <login> [--alias <alias>]

Signs a login in with Claude Code's "claude auth login" or Codex's "codex login", which open
the sign-in page in the browser.

  kurmis login claude         Adds a new Claude login. It gets Auto routing on and both limits
                              at 100%; "kurmis set" changes that.
  kurmis login codex          Adds a new Codex login.
  kurmis login work-example   Signs the login work-example in again, for example after it was
                              signed out. This works for the logins of plain claude and plain codex too.

<login> is the login's alias or its id, as "kurmis list" shows them. When a Claude login and a
Codex login have the same alias, put claude: or codex: in front, for example
claude:work-example.

Each login gets an id of random letters and digits, which never changes. Its alias is the name
you see and type. Kurmis makes the alias from the account's email: work@example.com gives
work-example. Without --alias, the alias follows the email when the account changes.

When the account you sign in to is already a kurmis login, kurmis signs the new sign-in out
again, adds nothing and says which login the account is.

Each extra login keeps its own credentials in its folder in the kurmis data folder (on macOS in
the Keychain). Kurmis prints the account's email and does not store it.

Options:
  --alias <alias>   The alias of the login, in place of the one made from the email. It is 1
                    to 32 lowercase letters, digits, "-" or "_", starts with a letter or digit,
                    and is not "claude" or "codex". No other login of the same provider may
                    have it. Kurmis keeps it when the email changes.
  -h, --help        Show this help.`,
    async run(args, context) {
      const parsed = parseCommandArgs("login", args, { alias: { type: "string" } }, context, true);
      if (typeof parsed === "number") return parsed;
      if (parsed.positionals.length !== 1) return usageError("login", "takes claude, codex, or one login by its alias or id", context);
      const alias = parsed.values.alias;
      let config;
      try {
        config = loadConfig();
      } catch (error) {
        if (error instanceof ConfigError) return fail2(context, error.message);
        throw error;
      }
      const target = loginTarget(parsed.positionals[0], config);
      if ("error" in target) return usageError("login", target.error, context);
      const isNew = target.kind === "new";
      const ref = isNew ? { id: freshLoginId(config), provider: target.provider, machineOwn: false } : { id: target.login.id, provider: target.login.provider, machineOwn: target.login.machineOwn };
      const name = isNew ? ref.id : target.login.alias;
      if (alias !== void 0) {
        const problem = aliasProblem(config, ref, alias);
        if (problem !== null) return usageError("login", problem, context);
      }
      let program;
      try {
        program = full.findProgram(ref.provider, { env: context.env });
      } catch (error) {
        if (error instanceof ProgramNotFoundError) return fail2(context, error.message);
        throw error;
      }
      let lock;
      try {
        lock = lockLogin(ref.id, name);
      } catch (error) {
        if (error instanceof LoginBusyError) return fail2(context, error.message);
        throw error;
      }
      try {
        if (!isNew) {
          let current;
          try {
            current = loadConfig();
          } catch (error) {
            if (error instanceof ConfigError) return fail2(context, error.message);
            throw error;
          }
          if (findLogin(current, ref.id) === void 0) return fail2(context, `${name} was removed by another kurmis command just now`);
        }
        return await signIn({ ref, isNew, name, lock, program, alias, context, deps: full });
      } finally {
        lock.release();
      }
    }
  };
}
var loginCommand = createLoginCommand();

// src/cli/commands/logout.ts
var import_node_fs20 = require("node:fs");
function exists(path) {
  try {
    (0, import_node_fs20.lstatSync)(path);
    return true;
  } catch {
    return false;
  }
}
function fail3(context, message) {
  writeLine(context.stderr, `kurmis logout: ${message}`);
  return EXIT_FAILURE;
}
function errorText3(error) {
  return error instanceof Error ? error.message : String(error);
}
function createLoginLogout(deps = {}) {
  const daemon = deps.daemon ?? realDaemonClient;
  const signOutDeps = {
    findProgram: deps.findProgram ?? realFindProgram,
    runProgram: deps.runProgram ?? runProgram,
    platform: deps.platform ?? process.platform
  };
  async function removeNow(login, context, options) {
    const { id } = login;
    const again = options.again ?? `kurmis logout ${id}`;
    const folder = loginFolder(login);
    let name = id;
    let listed = false;
    try {
      const found = findLogin(loadConfig(), id);
      if (found?.machineOwn === true) return fail3(context, `${found.alias} is ${machineOwnText(found.provider)} and cannot be removed.`);
      if (found !== void 0 && found.provider === login.provider) {
        listed = true;
        name = found.alias;
        changeConfig((config) => removeLogin(config, id));
      }
    } catch (error) {
      if (error instanceof ConfigError) return fail3(context, error.message);
      throw error;
    }
    const hasFolder = exists(folder);
    if (!listed && !hasFolder) {
      const record2 = login.provider === "codex" ? codexMergedRecordPath(login) : null;
      if (record2 === null || !exists(record2)) return fail3(context, `there is no login ${id}; "kurmis list" shows the logins`);
      (0, import_node_fs20.rmSync)(record2, { force: true });
      writeLine(context.stdout, `Deleted the record of what was merged into the Codex home of ${id}, which ${id} left behind.`);
      return EXIT_OK;
    }
    const reload = listed ? reloadText(await reloadIfRunning(daemon, context.env)) : null;
    if (hasFolder || login.provider === "claude") {
      const problem = await signOutLogin(login, context.env, signOutDeps);
      if (problem !== null) {
        const left = leftBehindText(login, signOutDeps.platform);
        if (options.keepFolderWhenSignOutFails === true && hasFolder) {
          if (reload !== null) writeLine(context.stdout, reload);
          const kept = listed ? ` ${name} is removed from kurmis, but its folder` : " Its folder";
          return fail3(context, `${problem}.${left}${kept} ${folder} is kept, so that "${again}" runs it again.`);
        }
        writeLine(context.stderr, `kurmis logout: ${problem}; ${name} is removed anyway.${left}`);
      }
    }
    try {
      removeTreeSync(folder);
      if (login.provider === "codex") (0, import_node_fs20.rmSync)(codexMergedRecordPath(login), { force: true });
    } catch (error) {
      const problem = `its folder ${folder} could not be deleted (${errorText3(error)})`;
      return fail3(context, listed ? `${name} is removed from kurmis, but ${problem}. Close what uses it and run "${again}".` : `${id} left a folder behind, but ${problem}. Close what uses it and run "${again}" again.`);
    }
    writeLine(context.stdout, listed ? `Removed ${name} (id ${id}).` : `Deleted the folder that ${id} left behind.`);
    if (reload !== null) writeLine(context.stdout, reload);
    return EXIT_OK;
  }
  return async (login, context, options = {}) => {
    if (login.machineOwn) return fail3(context, `${login.id} is ${machineOwnText(login.provider)} and cannot be removed.`);
    let name;
    try {
      name = findLogin(loadConfig(), login.id)?.alias ?? login.id;
    } catch (error) {
      if (error instanceof ConfigError) return fail3(context, error.message);
      throw error;
    }
    let lock;
    try {
      lock = lockLogin(login.id, name);
    } catch (error) {
      if (error instanceof LoginBusyError) return fail3(context, error.message);
      throw error;
    }
    try {
      return await removeNow(login, context, options);
    } finally {
      lock.release();
    }
  };
}
function logoutTarget(config, text2) {
  const resolved = resolveLogin(config, text2);
  if ("login" in resolved) {
    const login = resolved.login;
    if (login.machineOwn) {
      const cli = login.provider === "claude" ? "claude auth logout" : "codex logout";
      return {
        kind: "error",
        usage: true,
        message: `${login.alias} is ${machineOwnText(login.provider)} and cannot be removed. To sign it out, run "${cli}" yourself.`
      };
    }
    return { kind: "logins", logins: [{ id: login.id, provider: login.provider, machineOwn: false }] };
  }
  const colon = text2.indexOf(":");
  const prefix = colon < 0 ? null : text2.slice(0, colon);
  const id = colon < 0 ? text2 : text2.slice(colon + 1);
  const providers = prefix === null ? LOGIN_PROVIDERS : isLoginProvider(prefix) ? [prefix] : [];
  if (isLoginId(id) && findLogin(config, id) === void 0) {
    const refs = providers.map((provider) => ({ id, provider, machineOwn: false }));
    const withFolder = refs.filter((login) => exists(loginFolder(login)));
    if (withFolder.length > 0) return { kind: "logins", logins: withFolder };
    const recordOnly = refs.filter((login) => login.provider === "codex" && exists(codexMergedRecordPath(login)));
    if (recordOnly.length > 0) return { kind: "logins", logins: recordOnly };
  }
  return { kind: "error", usage: false, message: `${resolved.error}; "kurmis list" shows the logins` };
}
function createLogoutCommand(deps = {}) {
  const logOut = createLoginLogout(deps);
  return {
    name: "logout",
    summary: "Remove a login and its credentials",
    usage: `Usage: kurmis logout <login>

Signs a login out with "claude auth logout" or "codex logout", removes it from kurmis and
deletes its folder in the kurmis data folder. A running daemon stops using it at once.

<login> is the login's alias or its id, as "kurmis list" shows them. When a Claude login and a
Codex login have the same alias, put claude: or codex: in front, for example
codex:work-example.

The logins of plain claude and plain codex cannot be removed. To sign them out, run
"claude auth logout" or "codex logout" yourself.

An id that is in no list any more but still has a folder in the kurmis data folder, for
example after a removal that stopped half-way, has that folder deleted.

Options:
  -h, --help   Show this help.`,
    async run(args, context) {
      const parsed = parseCommandArgs("logout", args, {}, context, true);
      if (typeof parsed === "number") return parsed;
      if (parsed.positionals.length !== 1) return usageError("logout", "takes one login, by its alias or id", context);
      let target;
      try {
        target = logoutTarget(loadConfig(), parsed.positionals[0]);
      } catch (error) {
        if (error instanceof ConfigError) return fail3(context, error.message);
        throw error;
      }
      if (target.kind === "error") return target.usage ? usageError("logout", target.message, context) : fail3(context, target.message);
      for (const login of target.logins) {
        const code = await logOut(login, context);
        if (code !== EXIT_OK) return code;
      }
      return EXIT_OK;
    }
  };
}
var logoutCommand = createLogoutCommand();

// src/cli/commands/set.ts
function parseOnOff(text2) {
  if (text2 === "on") return true;
  if (text2 === "off") return false;
  return null;
}
function parsePercent(text2) {
  if (!/^\d{1,3}$/.test(text2)) return null;
  const value = Number(text2);
  return value >= 1 && value <= 100 ? value : null;
}
function patchFromOptions(options) {
  const patch = {};
  for (const [option, field] of [["auto", "routing"], ["use-first", "useFirst"]]) {
    const text2 = options[option];
    if (text2 === void 0) continue;
    const value = parseOnOff(text2);
    if (value === null) return { error: `--${option} takes on or off, not "${text2}"` };
    patch[field] = value;
  }
  for (const [option, field] of [["five-hour", "fiveHourLimit"], ["weekly", "weeklyLimit"]]) {
    const text2 = options[option];
    if (text2 === void 0) continue;
    const value = parsePercent(text2);
    if (value === null) return { error: `--${option} takes a whole number from 1 to 100, not "${text2}"` };
    patch[field] = value;
  }
  if (options.alias !== void 0) patch.alias = options.alias;
  if (Object.keys(patch).length === 0) return { error: "give at least one of --auto, --five-hour, --weekly, --use-first or --alias" };
  return patch;
}
function aliasSource(login) {
  if (login.aliasSetByUser) return "set by you";
  if (login.alias === login.id) return "the id, while kurmis knows no email for the login";
  return "made from the email";
}
function formatLoginSettings(login) {
  const lines = [`${login.alias} (${PROVIDER_NAMES2[login.provider]}, id ${login.id})`];
  if (login.machineOwn) lines.push(`  ${machineOwnText(login.provider)}`);
  lines.push(
    `  alias       ${login.alias} (${aliasSource(login)})`,
    `  auto        ${login.routing ? "on" : "off"}`,
    `  five-hour   ${String(login.fiveHourLimit)}%`,
    `  weekly      ${String(login.weeklyLimit)}%`,
    `  use-first   ${login.useFirst ? "on" : "off"}`
  );
  return lines.join("\n");
}
function failWith(context, message) {
  writeLine(context.stderr, `kurmis set: ${message}`);
  return EXIT_FAILURE;
}
function createSetCommand(deps = {}) {
  const daemon = deps.daemon ?? realDaemonClient;
  return {
    name: "set",
    summary: "Change a login's routing settings or alias",
    usage: `Usage: kurmis set <login> [--auto on|off] [--five-hour <1-100>] [--weekly <1-100>]
                       [--use-first on|off] [--alias <alias>]

Changes the settings of a login and prints them. A running daemon uses them at once. Give at
least one option.

<login> is the login's alias or its id, as "kurmis list" shows them. When a Claude login and a
Codex login have the same alias, put claude: or codex: in front, for example
claude:work-example.

Options:
  --auto on|off         Whether Auto routing may use the login. A session started with
                        "--login <login>" uses it either way.
  --five-hour <1-100>   Auto routing stops using the login once its five-hour window is at
                        this percentage.
  --weekly <1-100>      The same for the weekly window.
  --use-first on|off    Take this login before every other one that has room.
  --alias <alias>       The name you type and see for the login. It is 1 to 32 lowercase
                        letters, digits, "-" or "_", starts with a letter or digit, and is not
                        "claude" or "codex". No other login of the same provider may have it,
                        and it may not be another login's id.
                        Kurmis keeps an alias you set; without one, the alias follows the
                        account's email.
  -h, --help            Show this help.

Example:
  kurmis set work-example --weekly 80 --use-first on`,
    async run(args, context) {
      const parsed = parseCommandArgs("set", args, {
        auto: { type: "string" },
        "five-hour": { type: "string" },
        weekly: { type: "string" },
        "use-first": { type: "string" },
        alias: { type: "string" }
      }, context, true);
      if (typeof parsed === "number") return parsed;
      if (parsed.positionals.length !== 1) return usageError("set", "takes one login, by its alias or id", context);
      const patch = patchFromOptions(parsed.values);
      if ("error" in patch) return usageError("set", patch.error, context);
      let login;
      try {
        const config = loadConfig();
        const resolved = resolveLogin(config, parsed.positionals[0]);
        if ("error" in resolved) return usageError("set", `${resolved.error}; "kurmis list" shows the logins`, context);
        const target = resolved.login;
        if (patch.alias !== void 0) {
          const problem = aliasProblem(config, target, patch.alias);
          if (problem !== null) return usageError("set", problem, context);
        }
        const changed = changeConfig((current) => updateLogin(current, target.id, patch));
        login = findLogin(changed, target.id);
      } catch (error) {
        if (error instanceof ConfigError) return failWith(context, error.message);
        throw error;
      }
      writeLine(context.stdout, formatLoginSettings(login));
      const reload = reloadText(await reloadIfRunning(daemon, context.env));
      if (reload !== null) writeLine(context.stdout, reload);
      return EXIT_OK;
    }
  };
}
var setCommand = createSetCommand();

// src/cli/commands/setup.ts
var import_node_fs26 = require("node:fs");
var import_node_os15 = require("node:os");
var import_node_path26 = require("node:path");
var import_promises6 = require("node:readline/promises");

// src/data/remove-data-folder.ts
var import_node_fs21 = require("node:fs");
var import_node_path23 = require("node:path");
var FOLDERS = ["claude", "codex", "codex-merged", "locks", "probe", "settings"];
var FILES = ["autostart.js", "autostart.vbs", "config.json", "daemon.json", "daemon.log", "key", "paused.json", "state.json"];
function isKurmisEntry(name) {
  if (FOLDERS.includes(name) || FILES.includes(name)) return true;
  if (name.startsWith(".key-")) return true;
  return FILES.some((file) => name.startsWith(`${file}.`));
}
function lstatOrNull(path) {
  try {
    return (0, import_node_fs21.lstatSync)(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
function removeDataFolder(platform = process.platform) {
  const path = kurmisHome();
  const stat2 = lstatOrNull(path);
  if (stat2 === null) return { path, removed: true, left: [] };
  const link = stat2.isSymbolicLink();
  const folder = link ? import_node_fs21.realpathSync.native(path) : path;
  for (const name of (0, import_node_fs21.readdirSync)(folder)) {
    if (isKurmisEntry(name)) removeTreeSync((0, import_node_path23.join)(folder, name), { platform });
  }
  const left = (0, import_node_fs21.readdirSync)(folder);
  if (left.length > 0) return { path, removed: false, left };
  retryWhileLockedSync(() => (0, import_node_fs21.rmdirSync)(folder), platform);
  if (link) removeTreeSync(path, { platform });
  return { path, removed: true, left: [] };
}

// src/platform/autostart.ts
var import_node_fs23 = require("node:fs");

// src/platform/windows-autostart.ts
var import_node_fs22 = require("node:fs");
var import_node_path24 = require("node:path");
var RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
var RUN_VALUE_NAME = "kurmis";
var REG_VARIABLE = SYSTEM_PROGRAM_VARIABLES.reg;
var REG_TIMEOUT_MS = 3e4;
var RUN_ENTRY_DESCRIPTION = `${RUN_KEY} (value "${RUN_VALUE_NAME}")`;
function regProgram(env = process.env, processEnv = process.env) {
  return systemProgram("reg", env, processEnv);
}
function wscriptPath(env = process.env, processEnv = process.env) {
  return systemProgram("wscript", env, processEnv);
}
function regFor(env = process.env) {
  const program = regProgram(env);
  return (args) => runProgram(program, args, { timeoutMs: REG_TIMEOUT_MS, env });
}
function runValueData(wscript, scriptPath) {
  return windowsCommandLine([wscript, "//B", "//Nologo", "//E:JScript", scriptPath]);
}
var SCRIPT_HOST_SETTINGS_KEYS = [
  "HKCU\\Software\\Microsoft\\Windows Script Host\\Settings",
  "HKLM\\Software\\Microsoft\\Windows Script Host\\Settings"
];
function scriptHostDisabled(query) {
  if (query.code !== 0 || query.error !== null) return false;
  const value = parseRegQuery(query.stdout, "Enabled");
  return value !== null && /^(0x0+|0)$/i.test(value.data.trim());
}
function sameRunData(read, written) {
  const pattern = (written.match(/[\u0080-\uffff]+|[^\u0080-\uffff]+/g) ?? []).map((part) => {
    if (part.charCodeAt(0) < 128) return part.replace(/[\\^$.*+?()[\]{}|/-]/g, "\\$&");
    return `[\\s\\S]{1,${String(part.length * 2)}}`;
  }).join("");
  return new RegExp(`^${pattern}$`).test(read);
}
function regAddArgs(data) {
  return ["add", RUN_KEY, "/v", RUN_VALUE_NAME, "/t", "REG_SZ", "/d", data, "/f"];
}
function regQueryArgs() {
  return ["query", RUN_KEY, "/v", RUN_VALUE_NAME];
}
function regDeleteArgs() {
  return ["delete", RUN_KEY, "/v", RUN_VALUE_NAME, "/f"];
}
function parseRegQuery(stdout, name) {
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^ {4}(.+?) {4}(REG_[A-Z_]+)(?: {4}(.*))?$/.exec(line);
    if (match !== null && (match[1] ?? "").toLowerCase() === name.toLowerCase()) {
      return { type: match[2] ?? "", data: match[3] ?? "" };
    }
  }
  return null;
}
function jscriptString(text2) {
  if (/[\r\n\u2028\u2029]/.test(text2)) throw new Error("a value for the logon script has a line break in it");
  return `"${text2.replace(/[\\"]/g, (char) => `\\${char}`)}"`;
}
function windowsAutostartEnvironment(env = process.env, processEnv = process.env) {
  const out = {};
  const hooks = inheritedTestHooks(env, processEnv);
  for (const name of DAEMON_JOB_VARIABLES) {
    const value = env[name] || hooks[name];
    if (value !== void 0 && value !== "") out[name] = name === "KURMIS_HOME" ? import_node_path24.win32.resolve(value) : value;
  }
  return out;
}
function autostartCommandLine(script) {
  const assignments = Object.entries(script.environment).flatMap(([name, value]) => ["--env", `${name}=${value}`]);
  return windowsCommandLine([...script.programArguments, ...assignments]);
}
var PERCENT_SIGN_VARIABLE = "KURMIS_PERCENT_SIGN";
function autostartScript(script) {
  const command = autostartCommandLine(script);
  const lines = [
    "// Written by kurmis setup: starts the kurmis daemon at logon without a console window.",
    "// kurmis setup --uninstall-and-logout removes it.",
    'var shell = new ActiveXObject("WScript.Shell");',
    `shell.CurrentDirectory = ${jscriptString(script.cwd)};`
  ];
  if (command.includes("%")) {
    const escaped = command.replaceAll("%", `%${PERCENT_SIGN_VARIABLE}%`);
    lines.push(
      `// shell.Run replaces %NAME% with the variable NAME, so each percent sign is written as ${PERCENT_SIGN_VARIABLE}.`,
      `shell.Environment("Process").Item(${jscriptString(PERCENT_SIGN_VARIABLE)}) = "%";`,
      `var command = ${jscriptString(escaped)};`,
      `if (shell.ExpandEnvironmentStrings(command) == ${jscriptString(command)}) shell.Run(command, 0, false);`
    );
  } else {
    lines.push(`shell.Run(${jscriptString(command)}, 0, false);`);
  }
  return `${lines.join("\r\n")}\r
`;
}
var UTF16_BOM = Buffer.from([255, 254]);
function encodeScript(text2) {
  return Buffer.concat([UTF16_BOM, Buffer.from(text2, "utf16le")]);
}
function readScript(path) {
  let bytes;
  try {
    bytes = (0, import_node_fs22.readFileSync)(path);
  } catch {
    return null;
  }
  if (bytes.length >= 2 && bytes[0] === 255 && bytes[1] === 254) return bytes.subarray(2).toString("utf16le");
  return bytes.toString("utf8");
}
function regSaid(result) {
  if (result.error !== null) return result.error;
  const said = `${result.stderr}
${result.stdout}`.replace(/\s+/g, " ").trim();
  return said === "" ? `exit ${String(result.code)}` : `exit ${String(result.code)}: ${said}`;
}
var ok2 = (result) => result.code === 0 && result.error === null;
function userProfile(env) {
  return env.USERPROFILE ?? env.HOME ?? (0, import_node_path24.dirname)(windowsAutostartScriptPath());
}
async function scriptHostProblem(wscript, reg) {
  if (!(0, import_node_fs22.existsSync)(wscript)) {
    return `${wscript} does not exist, so Windows Script Host, which starts the daemon at logon without a console window, is not installed or was removed.`;
  }
  for (const key of SCRIPT_HOST_SETTINGS_KEYS) {
    if (scriptHostDisabled(await reg(["query", key, "/v", "Enabled"]))) {
      return `Windows Script Host, which starts the daemon at logon without a console window, is turned off ("Enabled" is 0 under ${key}). Turn it on, or ask whoever manages this machine, and run kurmis setup again.`;
    }
  }
  return null;
}
function removeOldVbsScript(scriptPath) {
  const old = (0, import_node_path24.join)((0, import_node_path24.dirname)(scriptPath), "autostart.vbs");
  if (old === scriptPath || !(0, import_node_fs22.existsSync)(old)) return false;
  (0, import_node_fs22.rmSync)(old, { force: true });
  return true;
}
async function registerWindowsAutostart(options) {
  const reg = options.reg ?? regFor(options.env);
  const scriptPath = options.scriptPath ?? windowsAutostartScriptPath();
  if (options.programArguments === void 0) throw new Error("registerWindowsAutostart needs programArguments");
  let text2;
  try {
    text2 = autostartScript({
      programArguments: options.programArguments,
      environment: windowsAutostartEnvironment(options.env),
      cwd: userProfile(options.env)
    });
  } catch (error) {
    return { changed: false, where: null, warning: `The logon entry was not written: ${error.message}.` };
  }
  const wscript = wscriptPath(options.env);
  const unusable = await scriptHostProblem(wscript, reg);
  if (unusable !== null) {
    return {
      changed: false,
      where: null,
      warning: `The logon entry was not written: ${unusable} The next kurmis command starts the daemon anyway.`,
      noEntryPossible: true
    };
  }
  let changed = false;
  if (readScript(scriptPath) !== text2) {
    makePrivateDirSync((0, import_node_path24.dirname)(scriptPath));
    (0, import_node_fs22.writeFileSync)(scriptPath, encodeScript(text2));
    changed = true;
  }
  const data = runValueData(wscript, scriptPath);
  const query = await reg(regQueryArgs());
  const current = ok2(query) ? parseRegQuery(query.stdout, RUN_VALUE_NAME) : null;
  if (current !== null && current.type === "REG_SZ" && sameRunData(current.data, data)) {
    if (removeOldVbsScript(scriptPath)) changed = true;
    return { changed, where: RUN_ENTRY_DESCRIPTION };
  }
  const added = await reg(regAddArgs(data));
  if (!ok2(added)) {
    return { changed, where: null, warning: `reg.exe could not write the logon entry ${RUN_ENTRY_DESCRIPTION} (${regSaid(added)}).` };
  }
  removeOldVbsScript(scriptPath);
  return { changed: true, where: RUN_ENTRY_DESCRIPTION };
}
async function unregisterWindowsAutostart(options) {
  const reg = options.reg ?? regFor(options.env);
  const scriptPath = options.scriptPath ?? windowsAutostartScriptPath();
  let changed = false;
  let warning;
  const query = await reg(regQueryArgs());
  if (ok2(query) && parseRegQuery(query.stdout, RUN_VALUE_NAME) !== null) {
    const deleted = await reg(regDeleteArgs());
    if (ok2(deleted)) changed = true;
    else warning = `reg.exe could not remove the logon entry ${RUN_ENTRY_DESCRIPTION} (${regSaid(deleted)}).`;
  }
  if (readScript(scriptPath) !== null) {
    (0, import_node_fs22.rmSync)(scriptPath, { force: true });
    changed = true;
  }
  if (removeOldVbsScript(scriptPath)) changed = true;
  return warning === void 0 ? { changed, where: RUN_ENTRY_DESCRIPTION } : { changed, where: RUN_ENTRY_DESCRIPTION, warning };
}

// src/platform/autostart.ts
var UNSUPPORTED = "Starting the daemon at login is not supported on this platform; the next kurmis command starts it.";
var NO_ENTRY = "kurmis is not running from its bundle, so there is no program to start at login; run kurmis setup from the installed kurmis.";
function loginProgram(options, platform) {
  const entry = options.entry === void 0 ? kurmisEntry({ env: options.env }) : options.entry;
  if (entry === null) return null;
  const node = options.nodePath ?? nodeForJobs({ env: options.env, platform });
  return [node, entry, ...DAEMON_START_ARGS];
}
function readText2(path) {
  try {
    return (0, import_node_fs23.readFileSync)(path, "utf8");
  } catch {
    return null;
  }
}
async function registerAutostart(options) {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin" && platform !== "win32") return { changed: false, where: null, warning: UNSUPPORTED };
  const programArguments = loginProgram(options, platform);
  if (programArguments === null) return { changed: false, where: null, warning: NO_ENTRY };
  const node = programArguments[0] ?? "";
  const temporary = isTemporaryPath(node, temporaryFolders(options.env, platform), platform) ? `The login item starts Node from ${node}, which is in a temporary folder and may be gone at your next login. Run kurmis setup again from a shell whose node is installed in a lasting place (for example, not one of fnm's per-shell folders).` : null;
  const result = platform === "win32" ? await registerWindowsAutostart({
    env: options.env,
    programArguments,
    ...options.windowsScriptPath === void 0 ? {} : { scriptPath: options.windowsScriptPath },
    ...options.reg === void 0 ? {} : { reg: options.reg }
  }) : await registerLaunchAgent(options, programArguments);
  if (temporary === null) return result;
  if (result.warning !== void 0) return { ...result, warning: `${result.warning} ${temporary}` };
  return { ...result, warning: temporary, warningOnly: true };
}
async function unregisterAutostart(options) {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    return await unregisterWindowsAutostart({
      env: options.env,
      ...options.windowsScriptPath === void 0 ? {} : { scriptPath: options.windowsScriptPath },
      ...options.reg === void 0 ? {} : { reg: options.reg }
    });
  }
  if (platform !== "darwin") return { changed: false, where: null };
  return await unregisterLaunchAgent(options);
}
async function registerLaunchAgent(options, programArguments) {
  const launchctl = options.launchctl ?? launchctlFor(options.env);
  const path = autostartPlistPath();
  const plist = daemonJobPlist({ label: AUTOSTART_LABEL, programArguments, environment: daemonJobEnvironment(options.env) });
  const written = readText2(path) !== plist;
  if (written) await writeFileAtomic(path, plist, { mode: 420 });
  const state = await jobState(AUTOSTART_LABEL, launchctl, options.uid);
  if (state.loaded && !written && (state.path === null || state.path === path)) return { changed: false, where: path };
  try {
    if (state.loaded) await bootoutJob(AUTOSTART_LABEL, launchctl, options.uid);
    await bootstrapJob(path, launchctl, options.uid);
  } catch (error) {
    return {
      changed: true,
      where: path,
      warning: `The login item is written and starts the daemon at your next login, but it could not be loaded now: ${error.message}`,
      loadsAtNextLogin: true
    };
  }
  return { changed: true, where: path };
}
async function unregisterLaunchAgent(options) {
  const launchctl = options.launchctl ?? launchctlFor(options.env);
  const path = autostartPlistPath();
  let changed = false;
  let warning;
  try {
    changed = await bootoutJob(AUTOSTART_LABEL, launchctl, options.uid);
  } catch (error) {
    warning = `${error.message} The login item's file is removed, so it does not start the daemon at the next login.`;
  }
  if (readText2(path) !== null) {
    (0, import_node_fs23.rmSync)(path, { force: true });
    changed = true;
  }
  return warning === void 0 ? { changed, where: path } : { changed, where: path, warning };
}

// src/cli/global-routing.ts
var import_node_fs25 = require("node:fs");

// src/cli/global-settings.ts
var import_node_fs24 = require("node:fs");
var import_node_path25 = require("node:path");
var BASE_URL = "ANTHROPIC_BASE_URL";
var CUSTOM_HEADERS2 = "ANTHROPIC_CUSTOM_HEADERS";
var KEY_VARIABLES = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", ...OAUTH_TOKEN_VARIABLES];
var BOM = "\uFEFF";
var LOOPBACK_URL = /^http:\/\/127\.0\.0\.1:(\d{1,5})\/?$/;
var SettingsFileError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "SettingsFileError";
  }
};
function isWhitespace2(char) {
  return char === " " || char === "	" || char === "\n" || char === "\r";
}
var Scanner = class {
  constructor(text2) {
    this.text = text2;
  }
  text;
  skipWhitespace(pos) {
    while (isWhitespace2(this.text[pos])) pos++;
    return pos;
  }
  /** The end of the string whose opening quote is at `pos`. */
  stringEnd(pos) {
    let i = pos + 1;
    while (i < this.text.length) {
      const char = this.text[i];
      if (char === "\\") i += 2;
      else if (char === '"') return i + 1;
      else i++;
    }
    throw new SettingsFileError("the file ends inside a string");
  }
  /** The end of the value that starts at `pos`. */
  valueEnd(pos) {
    const char = this.text[pos];
    if (char === '"') return this.stringEnd(pos);
    if (char === "{" || char === "[") return this.containerEnd(pos);
    let i = pos;
    while (i < this.text.length && !isWhitespace2(this.text[i]) && !",]}".includes(this.text[i])) i++;
    return i;
  }
  containerEnd(pos) {
    let depth = 0;
    let i = pos;
    while (i < this.text.length) {
      const char = this.text[i];
      if (char === '"') {
        i = this.stringEnd(i);
        continue;
      }
      if (char === "{" || char === "[") depth++;
      else if (char === "}" || char === "]") {
        depth--;
        if (depth === 0) return i + 1;
      }
      i++;
    }
    throw new SettingsFileError("the file ends inside an object or a list");
  }
  /** The members of the object whose `{` is at `open`. */
  object(open4) {
    const members = [];
    let pos = this.skipWhitespace(open4 + 1);
    if (this.text[pos] === "}") return { open: open4, close: pos, members };
    for (; ; ) {
      const keyStart = pos;
      const keyEnd = this.stringEnd(keyStart);
      const name = JSON.parse(this.text.slice(keyStart, keyEnd));
      pos = this.skipWhitespace(keyEnd) + 1;
      const valueStart = this.skipWhitespace(pos);
      const valueEnd = this.valueEnd(valueStart);
      members.push({ name, keyStart, keyEnd, valueStart, valueEnd });
      pos = this.skipWhitespace(valueEnd);
      if (this.text[pos] === "}") return { open: open4, close: pos, members };
      pos = this.skipWhitespace(pos + 1);
    }
  }
};
function isPlainObject3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseSettings2(text2) {
  let value;
  try {
    value = JSON.parse(text2);
  } catch {
    throw new SettingsFileError(`it is ${notJsonText(text2)}`);
  }
  if (!isPlainObject3(value)) throw new SettingsFileError("its top level is not a JSON object");
  const scanner = new Scanner(text2);
  const top = scanner.object(scanner.skipWhitespace(0));
  const envMembers = top.members.filter((member) => member.name === "env");
  if (envMembers.length > 1) throw new SettingsFileError('it has more than one "env" key');
  const envMember = envMembers[0];
  if (envMember === void 0) return { text: text2, top, env: null };
  const envValue = value.env;
  if (!isPlainObject3(envValue)) throw new SettingsFileError('its "env" is not a JSON object');
  const node = scanner.object(envMember.valueStart);
  for (const name of ROUTING_VARIABLES) {
    if (node.members.filter((member) => member.name === name).length > 1) {
      throw new SettingsFileError(`its "env" has more than one "${name}" key`);
    }
  }
  return { text: text2, top, env: { member: envMember, node, value: envValue } };
}
function layoutOf(parsed) {
  const eol = parsed.text.includes("\r\n") ? "\r\n" : "\n";
  const first = parsed.top.members[0];
  let unit = "  ";
  if (first !== void 0) {
    const before = parsed.text.slice(parsed.top.open + 1, first.keyStart);
    const newline2 = before.lastIndexOf("\n");
    if (newline2 >= 0 && before.length > newline2 + 1) unit = before.slice(newline2 + 1);
  }
  return { eol, unit, colon: colonOf(parsed.text, parsed.top, ": ") };
}
function lineIndent(text2, pos) {
  const start2 = text2.lastIndexOf("\n", pos - 1) + 1;
  let end = start2;
  while (text2[end] === " " || text2[end] === "	") end++;
  return text2.slice(start2, end);
}
function colonOf(text2, node, fallback) {
  const first = node.members[0];
  return first === void 0 ? fallback : text2.slice(first.keyEnd, first.valueStart);
}
function separatorOf(text2, node, layout) {
  const [first, second] = node.members;
  const gap = second === void 0 ? text2.slice(node.open + 1, first.keyStart) : text2.slice(first.valueEnd, second.keyStart).replace(",", "");
  const newline2 = gap.lastIndexOf("\n");
  return newline2 >= 0 ? `${layout.eol}${gap.slice(newline2 + 1)}` : gap;
}
function addMember(text2, node, name, valueJson, layout) {
  const member = `${JSON.stringify(name)}${colonOf(text2, node, layout.colon)}${valueJson}`;
  const last = node.members.at(-1);
  if (last !== void 0) {
    return `${text2.slice(0, last.valueEnd)},${separatorOf(text2, node, layout)}${member}${text2.slice(last.valueEnd)}`;
  }
  if (!text2.includes("\n")) {
    return `${text2.slice(0, node.open + 1)}${member}${text2.slice(node.close)}`;
  }
  const outer = lineIndent(text2, node.open);
  return `${text2.slice(0, node.open + 1)}${layout.eol}${outer}${layout.unit}${member}${layout.eol}${outer}${text2.slice(node.close)}`;
}
function removeMember(text2, node, index) {
  const member = node.members[index];
  if (node.members.length === 1) {
    return `${text2.slice(0, node.open + 1)}${text2.slice(node.close)}`;
  }
  if (index > 0) {
    const previous = node.members[index - 1];
    return `${text2.slice(0, previous.valueEnd)}${text2.slice(member.valueEnd)}`;
  }
  const next = node.members[1];
  return `${text2.slice(0, member.keyStart)}${text2.slice(next.keyStart)}`;
}
function replaceValue(text2, member, valueJson) {
  return `${text2.slice(0, member.valueStart)}${valueJson}${text2.slice(member.valueEnd)}`;
}
function newEnvJson(values, outerIndent, layout, oneLine) {
  const entries = Object.entries(values).map(([name, value]) => `${JSON.stringify(name)}${layout.colon}${JSON.stringify(value)}`);
  if (oneLine) return `{${entries.join(layout.colon.endsWith(" ") ? ", " : ",")}}`;
  const inner = `${outerIndent}${layout.unit}`;
  return `{${layout.eol}${entries.map((entry) => `${inner}${entry}`).join(`,${layout.eol}`)}${layout.eol}${outerIndent}}`;
}
function kurmisEnvValues(values, existingHeaders) {
  const routed = routedClaudeEnv({
    port: values.port,
    key: values.key,
    login: null,
    startedOn: null,
    secureStorageDir: null,
    inheritedCustomHeaders: null
  });
  const out = {};
  for (const name of ROUTING_VARIABLES) {
    const value = routed.set[name];
    if (value !== void 0) out[name] = value;
  }
  if (values.credentialsOfItsOwn === true) out[CUSTOM_HEADERS2] = withRouteHeaders(null, values.key, null, STARTED_ON_NONE);
  const theirs = othersHeaderLines(existingHeaders ?? "");
  if (theirs.length > 0) out[CUSTOM_HEADERS2] = [...theirs, out[CUSTOM_HEADERS2]].join("\n");
  return out;
}
function hasKurmisHeader(headers) {
  return typeof headers === "string" && parseCustomHeaders(headers).some((header) => header.name.toLowerCase() === KEY_HEADER);
}
function othersHeaderLines(headers) {
  return headers.split(/\r?\n/).filter((line) => {
    const colon = line.indexOf(":");
    const name = colon < 0 ? "" : line.slice(0, colon).trim().toLowerCase();
    return line.trim().length > 0 && !KURMIS_HEADERS.includes(name);
  });
}
function isKurmisBaseUrl(value, env, port) {
  if (typeof value !== "string") return false;
  const match = LOOPBACK_URL.exec(value);
  if (match === null) return false;
  return port !== null && Number(match[1]) === port || hasKurmisHeader(env[CUSTOM_HEADERS2]);
}
function displayValue(value) {
  return typeof value === "string" ? value : JSON.stringify(value);
}
function keyVariableWarnings(env) {
  if (env === void 0) return [];
  return KEY_VARIABLES.filter((name) => env[name] !== void 0 && env[name] !== "").map((name) => OAUTH_TOKEN_VARIABLES.includes(name) ? `The "env" also sets ${name}, so a plain claude signs in with that subscription token instead of the credentials of the login plain claude uses, and a request kurmis sends on that login may be billed to the token's account. Kurmis leaves it; remove it if you want your logins used. "kurmis claude" does not use it.` : `The "env" also sets ${name}, so Claude Code signs its requests with that key instead of a subscription login. Kurmis leaves it; remove it if you want your logins used.`);
}
function backupBefore(backupText) {
  if (backupText === null || backupText === void 0) return null;
  let value;
  try {
    value = JSON.parse(withoutBom3(backupText));
  } catch {
    return null;
  }
  if (!isPlainObject3(value)) return null;
  if (value.env === void 0) return { env: null };
  if (!isPlainObject3(value.env)) return null;
  const env = value.env;
  if (hasKurmisHeader(env[CUSTOM_HEADERS2])) return null;
  return { env };
}
function withoutBom3(text2) {
  return text2.startsWith(BOM) ? text2.slice(BOM.length) : text2;
}
function emptyEdit(text2) {
  return { text: text2, changed: false, changes: [], envCreated: false, envRemoved: false, hadKurmis: false, warnings: [] };
}
function applySetupToText(text2, values) {
  if (text2 === null || text2.trim().length === 0) {
    const env2 = kurmisEnvValues(values, null);
    const created = `${JSON.stringify({ env: env2 }, null, 2)}
`;
    const eol = text2?.includes("\r\n") === true ? created.replace(/\n/g, "\r\n") : created;
    return {
      text: eol,
      changed: true,
      changes: Object.keys(env2).map((name) => ({ name, action: "added" })),
      envCreated: true,
      envRemoved: false,
      hadKurmis: false,
      warnings: []
    };
  }
  const bom = text2.startsWith(BOM) ? BOM : "";
  let body = text2.slice(bom.length);
  let parsed = parseSettings2(body);
  const layout = layoutOf(parsed);
  const result = emptyEdit(text2);
  const env = parsed.env?.value ?? {};
  result.warnings.push(...keyVariableWarnings(parsed.env?.value));
  const baseUrl = env[BASE_URL];
  if (baseUrl !== void 0 && !isKurmisBaseUrl(baseUrl, env, values.port)) {
    throw new SettingsFileError(
      `its "env" already sets ${BASE_URL} to ${displayValue(baseUrl)}, which is not kurmis' address. Kurmis does not replace it; remove it from the file first if you want Claude Code routed through kurmis.`
    );
  }
  const headers = env[CUSTOM_HEADERS2];
  if (headers !== void 0 && typeof headers !== "string") {
    throw new SettingsFileError(`its "env" sets ${CUSTOM_HEADERS2} to something other than a string`);
  }
  const wanted = kurmisEnvValues(values, headers ?? null);
  result.hadKurmis = baseUrl !== void 0 && isKurmisBaseUrl(baseUrl, env, values.port) || hasKurmisHeader(headers);
  if (parsed.env === null) {
    const outer = parsed.top.members.length > 0 ? lineIndent(body, parsed.top.members[0].keyStart) : `${lineIndent(body, parsed.top.open)}${layout.unit}`;
    const json = newEnvJson(wanted, outer, layout, !body.includes("\n"));
    body = addMember(body, parsed.top, "env", json, layout);
    result.changes.push(...Object.keys(wanted).map((name) => ({ name, action: "added" })));
    result.envCreated = true;
  } else {
    for (const [name, value] of Object.entries(wanted)) {
      const envNode = parsed.env.node;
      const member = envNode.members.find((candidate) => candidate.name === name);
      const current = parsed.env.value[name];
      if (member === void 0) {
        body = addMember(body, envNode, name, JSON.stringify(value), layout);
        result.changes.push({ name, action: "added" });
      } else if (current === value) {
        result.changes.push({ name, action: "unchanged" });
      } else if (name === BASE_URL) {
        body = replaceValue(body, member, JSON.stringify(value));
        result.changes.push({ name, action: "updated" });
      } else if (name === CUSTOM_HEADERS2) {
        const theirs = othersHeaderLines(current).length > 0;
        body = replaceValue(body, member, JSON.stringify(value));
        result.changes.push({
          name,
          action: hasKurmisHeader(current) ? "updated" : "added",
          ...theirs ? { note: "your own header lines were kept" } : {}
        });
      } else {
        result.changes.push({ name, action: "kept", note: `it holds your own value (${displayValue(current)}), which kurmis leaves` });
      }
      parsed = parseSettings2(body);
    }
  }
  result.text = `${bom}${body}`;
  result.changed = result.text !== text2;
  return result;
}
function undoSetupInText(text2, values) {
  if (text2.trim().length === 0) return emptyEdit(text2);
  const bom = text2.startsWith(BOM) ? BOM : "";
  let body = text2.slice(bom.length);
  let parsed = parseSettings2(body);
  const result = emptyEdit(text2);
  if (parsed.env === null) return result;
  const env = parsed.env.value;
  const backup = backupBefore(values.backupText);
  const before = backup?.env ?? null;
  const plain = kurmisEnvValues({ port: values.port ?? 1, key: "unused" }, null);
  const baseUrlIsKurmis = isKurmisBaseUrl(env[BASE_URL], env, values.port);
  for (const name of ROUTING_VARIABLES) {
    const current = parsed.env.value[name];
    if (current === void 0) continue;
    const index = parsed.env.node.members.findIndex((member2) => member2.name === name);
    const member = parsed.env.node.members[index];
    if (name === BASE_URL) {
      if (!baseUrlIsKurmis) {
        result.changes.push({ name, action: "kept", note: `it points at ${displayValue(current)}, not at kurmis` });
        continue;
      }
      body = removeMember(body, parsed.env.node, index);
      result.changes.push({ name, action: "removed" });
    } else if (name === CUSTOM_HEADERS2) {
      if (typeof current !== "string" || !parseCustomHeaders(current).some((header) => KURMIS_HEADERS.includes(header.name.toLowerCase()))) {
        continue;
      }
      const theirs = othersHeaderLines(current);
      if (theirs.length === 0) {
        body = removeMember(body, parsed.env.node, index);
        result.changes.push({ name, action: "removed" });
      } else {
        const original = before?.[name];
        const restored = typeof original === "string" && sameLines(othersHeaderLines(original), theirs) ? original : theirs.join("\n");
        body = replaceValue(body, member, JSON.stringify(restored));
        result.changes.push({ name, action: "updated", note: "kurmis' header lines were removed and yours were kept" });
      }
    } else if (current !== plain[name]) {
      result.changes.push({ name, action: "kept", note: `its value (${displayValue(current)}) is not the one kurmis sets` });
      continue;
    } else if (before !== null && before[name] === current) {
      result.changes.push({ name, action: "kept", note: "the file already had this value before kurmis changed it" });
      continue;
    } else {
      body = removeMember(body, parsed.env.node, index);
      result.changes.push({ name, action: "removed" });
    }
    parsed = parseSettings2(body);
  }
  const envWasThere = backup !== null && backup.env !== null;
  if (parsed.env !== null && parsed.env.node.members.length === 0 && !envWasThere && result.changes.some((change) => change.action === "removed")) {
    const index = parsed.top.members.findIndex((member) => member.name === "env");
    body = removeMember(body, parsed.top, index);
    result.envRemoved = true;
  }
  result.text = `${bom}${body}`;
  result.changed = result.text !== text2;
  return result;
}
function sameLines(a, b) {
  return a.length === b.length && a.every((line, index) => line === b[index]);
}
function claudeSettingsPath(env) {
  const configDir = env.CLAUDE_CONFIG_DIR;
  if (configDir === void 0 || configDir === "") return claudeUserSettingsPath(env);
  const dir = (0, import_node_path25.resolve)(configDir);
  const inside = (0, import_node_path25.relative)(kurmisHome(), dir);
  if (inside === "" || !inside.startsWith("..") && !(0, import_node_path25.isAbsolute)(inside)) {
    throw new SettingsFileError(
      `CLAUDE_CONFIG_DIR is ${dir}, which is inside kurmis' data folder. Run kurmis setup from a shell without it.`
    );
  }
  return (0, import_node_path25.join)(dir, "settings.json");
}
function backupPathFor(settingsPath) {
  return `${settingsPath}.kurmis-backup`;
}
function readText3(path) {
  try {
    return (0, import_node_fs24.readFileSync)(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
function writeTarget(path) {
  try {
    return (0, import_node_fs24.realpathSync)(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let current = path;
  for (let hop = 0; hop < 40; hop++) {
    let stats;
    try {
      stats = (0, import_node_fs24.lstatSync)(current);
    } catch (error) {
      if (error.code === "ENOENT") return current;
      throw error;
    }
    if (!stats.isSymbolicLink()) return current;
    current = (0, import_node_path25.resolve)((0, import_node_path25.dirname)(current), (0, import_node_fs24.readlinkSync)(current));
  }
  throw new SettingsFileError(`${path} is a chain of more than 40 symbolic links`);
}
function linkTargetOf(path) {
  try {
    if (!(0, import_node_fs24.lstatSync)(path).isSymbolicLink()) return null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  return writeTarget(path);
}
function restrictIfPresent(path) {
  try {
    return restrictToUserSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
function backUp(path, replace, platform) {
  const backup = backupPathFor(path);
  if (!replace) {
    try {
      (0, import_node_fs24.copyFileSync)(path, backup, import_node_fs24.constants.COPYFILE_EXCL);
    } catch (error) {
      if (error.code === "EEXIST") return null;
      throw error;
    }
    if (platform !== "win32") (0, import_node_fs24.chmodSync)(backup, PRIVATE_FILE_MODE);
    return backup;
  }
  const temp = `${backup}.${String(process.pid)}.tmp`;
  try {
    (0, import_node_fs24.copyFileSync)(path, temp);
    if (platform !== "win32") (0, import_node_fs24.chmodSync)(temp, PRIVATE_FILE_MODE);
    replaceFileSync(temp, backup);
  } catch (error) {
    (0, import_node_fs24.rmSync)(temp, { force: true });
    throw error;
  }
  return backup;
}
function isReadOnly(mode) {
  return (mode & 128) === 0;
}
function readOnlyError(target) {
  return new SettingsFileError(`it is read-only. Clear that with attrib -R "${target}" and run the command again`);
}
function writeEdit(path, edit, existed, userOnly, platform) {
  const target = writeTarget(path);
  if (!edit.changed) return { backup: null, modeBefore: userOnly && existed ? restrictToUserSync(target, platform) : null };
  const before = existed ? (0, import_node_fs24.statSync)(target).mode & 511 : PRIVATE_FILE_MODE;
  if (platform === "win32" && existed && isReadOnly(before)) {
    throw readOnlyError(target);
  }
  const backup = existed ? backUp(path, userOnly && !edit.hadKurmis, platform) : null;
  const mode = userOnly ? userOnlyMode(before) : before;
  try {
    writeFileAtomicSync(target, edit.text, { mode });
  } catch (error) {
    const code = error.code;
    if (code === "EPERM" || code === "EACCES" || code === "EBUSY") {
      throw new SettingsFileError(`it could not be written (${code}): another program may hold it open, or the file or its folder may not be writable by you`);
    }
    throw error;
  }
  if (platform === "win32") return { backup, modeBefore: null };
  (0, import_node_fs24.chmodSync)(target, mode);
  return { backup, modeBefore: existed && mode !== before ? before : null };
}
function failWith2(path, error) {
  if (error instanceof SettingsFileError) {
    throw new SettingsFileError(`${path} was not changed: ${error.message}`);
  }
  throw error;
}
function setupSettingsFile(path, values, platform = process.platform) {
  const text2 = readText3(path);
  let edit;
  let written;
  try {
    edit = applySetupToText(text2, values);
    written = writeEdit(path, edit, text2 !== null, true, platform);
  } catch (error) {
    failWith2(path, error);
  }
  const backupModeBefore = written.backup === null ? restrictIfPresent(backupPathFor(path)) : null;
  return {
    ...edit,
    path,
    existed: text2 !== null,
    backupWritten: written.backup,
    linkTarget: linkTargetOf(path),
    modeBefore: written.modeBefore,
    backupModeBefore
  };
}
function checkSetupSettingsFile(path, values, platform = process.platform) {
  try {
    const text2 = readText3(path);
    const edit = applySetupToText(text2, values);
    if (platform === "win32" && text2 !== null && isReadOnly((0, import_node_fs24.statSync)(writeTarget(path)).mode)) {
      throw readOnlyError(writeTarget(path));
    }
    return edit.hadKurmis;
  } catch (error) {
    failWith2(path, error);
  }
}
function undoSettingsFile(path, values, platform = process.platform) {
  const text2 = readText3(path);
  if (text2 === null) {
    return { ...emptyEdit(""), path, existed: false, backupWritten: null, linkTarget: null, modeBefore: null, backupModeBefore: null };
  }
  let edit;
  let written;
  try {
    edit = undoSetupInText(text2, { ...values, backupText: readText3(backupPathFor(path)) });
    written = writeEdit(path, edit, true, false, platform);
  } catch (error) {
    failWith2(path, error);
  }
  return { ...edit, path, existed: true, backupWritten: written.backup, linkTarget: linkTargetOf(path), modeBefore: null, backupModeBefore: null };
}

// src/cli/global-routing.ts
function isPaused() {
  return (0, import_node_fs25.existsSync)(pausedFilePath());
}
function markPaused(now = /* @__PURE__ */ new Date()) {
  writeJsonFileSync(pausedFilePath(), { pausedAt: now.toISOString() }, { mode: PRIVATE_FILE_MODE });
}
function clearPaused() {
  const path = pausedFilePath();
  if (!(0, import_node_fs25.existsSync)(path)) return false;
  (0, import_node_fs25.rmSync)(path, { force: true });
  return true;
}

// src/cli/commands/setup.ts
var NPM_UNINSTALL = "npm uninstall -g kurmis";
var USAGE3 = `Usage: kurmis setup [--pause | --uninstall-and-logout [--yes]]

Turns global routing on: every Claude Code on this machine goes through kurmis, not only the
ones started with "kurmis claude". Setup:

- starts the daemon now, and goes no further when it cannot;
- puts kurmis' address and key in the "env" block of your Claude Code settings file,
  ~/.claude/settings.json (or settings.json in CLAUDE_CONFIG_DIR when that is set), so a plain
  "claude" and the IDE extensions use your kurmis logins too. Nothing else in the file changes,
  and the file is copied to settings.json.kurmis-backup before kurmis adds its settings.
  Because the file then holds kurmis' key, on macOS and Linux setup makes it and the copy
  readable only by you;
- makes the kurmis daemon start when you log in (macOS and Windows).

Claude Code sessions that are already open keep the settings they started with; start them
again.

Options:
  --pause                 Take kurmis' settings out of the settings file, so a plain "claude"
                          no longer goes through kurmis. A setting you changed yourself is left
                          as it is. The daemon, its start at login, your logins and the backup
                          copy stay. "kurmis setup" turns global routing on again.
  --uninstall-and-logout  Remove everything kurmis set up: its settings and the backup copy,
                          the daemon's start at login, every login you added to kurmis (each is
                          signed out first, which removes its Keychain or Credential Manager
                          item), the daemon and the kurmis data folder. The logins plain
                          claude and plain codex use are not signed out, so a plain "claude"
                          and "codex" keep working. It lists what it removes and asks first. The
                          last step, "${NPM_UNINSTALL}", is yours to run.
  --yes                   With --uninstall-and-logout: do not ask. Without a terminal to ask
                          at, --uninstall-and-logout needs it.
  -h, --help              Show this help.`;
function changeLine(change, undo) {
  const note = change.note === void 0 ? "" : ` (${change.note})`;
  switch (change.action) {
    case "added":
      return `Added ${change.name}${note}.`;
    case "updated":
      return undo ? `Changed ${change.name}${note}.` : `Updated ${change.name} to kurmis' current value${note}.`;
    case "removed":
      return `Removed ${change.name}${note}.`;
    case "unchanged":
      return null;
    case "kept":
      return `Left ${change.name} as it is: ${change.note ?? "it is not kurmis' value"}.`;
  }
}
function reportFile(result, undo, context) {
  writeLine(context.stdout, `Claude Code settings: ${result.path}`);
  if (result.backupWritten !== null) writeLine(context.stdout, `Saved a copy of the file as it was to ${result.backupWritten}.`);
  if (!undo && !result.existed) writeLine(context.stdout, "Created the file, readable only by you.");
  if (result.modeBefore !== null) {
    writeLine(context.stdout, `Made the file readable only by you, because it holds kurmis' key (its mode was ${modeText(result.modeBefore)}).`);
  }
  if (result.backupModeBefore !== null) {
    writeLine(context.stdout, `Made ${backupPathFor(result.path)} readable only by you (its mode was ${modeText(result.backupModeBefore)}).`);
  }
  if (result.envCreated) writeLine(context.stdout, 'Added an "env" block.');
  for (const change of result.changes) {
    const line = changeLine(change, undo);
    if (line !== null) writeLine(context.stdout, line);
  }
  if (result.envRemoved) writeLine(context.stdout, 'Removed the "env" block, which had nothing else in it.');
  if (!result.changed) {
    writeLine(context.stdout, undo ? "The file has none of kurmis' settings; nothing to take out." : "The file already has kurmis' settings; nothing to change.");
  }
  for (const warning of result.warnings) writeLine(context.stderr, `Warning: ${warning}`);
  if (!undo && result.linkTarget !== null) {
    writeLine(context.stderr, `Warning: ${result.path} is a symbolic link, so kurmis' key is written to the file it points to, ${result.linkTarget}.`);
  }
}
function modeText(mode) {
  return `0${(mode & 511).toString(8).padStart(3, "0")}`;
}
function errorText4(error) {
  return error instanceof Error ? error.message : String(error);
}
async function autostartStep(remove, deps, context) {
  let result;
  try {
    const options = { env: context.env, platform: deps.platform };
    result = remove ? await deps.unregisterAutostart(options) : await deps.registerAutostart(options);
  } catch (error) {
    result = { changed: false, where: null, warning: errorText4(error) };
  }
  const supported = deps.platform === "darwin" || deps.platform === "win32";
  const warnsOnly = result.warningOnly === true || result.loadsAtNextLogin === true || result.noEntryPossible === true || !supported;
  if (!remove && result.warning !== void 0 && warnsOnly) {
    writeLine(context.stderr, `Warning: ${result.warning}`);
    return true;
  }
  if (result.warning !== void 0) {
    writeLine(context.stderr, remove ? `Could not remove the daemon's start at login: ${result.warning}` : `Could not make the daemon start at login: ${result.warning}`);
    return false;
  }
  const where = result.where === null ? "" : ` (${result.where})`;
  if (remove) {
    if (!supported) return true;
    writeLine(context.stdout, result.changed ? `Removed the daemon's start at login${where}.` : "The daemon was not set to start at login.");
  } else {
    writeLine(context.stdout, result.changed ? `The daemon now starts at login${where}.` : `The daemon already starts at login${where}.`);
  }
  return true;
}
async function daemonStep(port, path, hadKurmis, deps, context) {
  const unchanged = hadKurmis ? `${path} was not changed. It still holds kurmis' settings from an earlier setup, so Claude Code that reads it reaches kurmis only while a daemon runs on the port they name. Run "kurmis setup" again once the daemon runs, or "kurmis setup --pause" to take them out.` : `${path} was not changed, so Claude Code does not use kurmis yet. Run "kurmis setup" again once the daemon runs.`;
  try {
    const connection = await deps.daemon.ensureDaemon({ env: context.env });
    if (connection.port !== port) {
      writeLine(
        context.stderr,
        `The daemon runs on port ${String(connection.port)}, but config.json names port ${String(port)}. Stop it with "kurmis daemon stop" and run "kurmis setup" again, so it starts on that port.`
      );
      writeLine(context.stderr, unchanged);
      return null;
    }
    writeLine(context.stdout, `The daemon is running on port ${String(connection.port)}.`);
    return connection.key;
  } catch (error) {
    writeLine(context.stderr, `The daemon could not be started: ${errorText4(error)}`);
    writeLine(context.stderr, `${unchanged} "kurmis daemon start" starts it and says what is wrong.`);
    return null;
  }
}
async function runningDaemonPid(deps, context) {
  try {
    return (await deps.daemon.findDaemon({ env: context.env }))?.pid ?? null;
  } catch {
    return null;
  }
}
function defaultFolderRefusal(env, platform) {
  const value = env["CLAUDE_CONFIG_DIR"];
  const home = (0, import_node_os15.homedir)();
  if (value === void 0 || !configDirHasOwnCredentials(env, platform)) return null;
  const folder = (0, import_node_path26.join)(home, ".claude");
  const defaultFile = (0, import_node_path26.join)(folder, "settings.json");
  if (namesDefaultClaudeFolder(value, platform, home)) {
    return `CLAUDE_CONFIG_DIR is set to ${value}, which is the default Claude Code folder ${folder}. A claude started with CLAUDE_CONFIG_DIR set keeps its credentials apart from one started without it, even when the variable names that folder, and both read ${defaultFile}, so kurmis cannot write settings there that are right for both. Unset CLAUDE_CONFIG_DIR and run "kurmis setup" again.`;
  }
  if (sharesDefaultSettingsFile(value, platform, home)) {
    return `CLAUDE_CONFIG_DIR is set to ${value}, and ${(0, import_node_path26.join)(value, "settings.json")} is a link to the default Claude Code settings file ${defaultFile}. A claude started with CLAUDE_CONFIG_DIR set signs in with the credentials in ${value}, a plain claude with those in ${folder}, and both read that one file, so kurmis cannot write settings there that are right for both. Unset CLAUDE_CONFIG_DIR and run "kurmis setup" again, or give that folder a settings.json of its own.`;
  }
  return null;
}
function settingsPathOrFail(context) {
  try {
    return claudeSettingsPath(context.env);
  } catch (error) {
    if (!(error instanceof SettingsFileError)) throw error;
    writeLine(context.stderr, `kurmis setup: ${error.message}`);
    return null;
  }
}
function portOrNull() {
  try {
    return loadConfig().port;
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    return null;
  }
}
async function runSetup(deps, context) {
  const refusal = defaultFolderRefusal(context.env, deps.platform);
  if (refusal !== null) {
    writeLine(context.stderr, `kurmis setup: ${refusal}`);
    return EXIT_FAILURE;
  }
  const path = settingsPathOrFail(context);
  if (path === null) return EXIT_FAILURE;
  let port;
  try {
    port = loadConfig().port;
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    writeLine(context.stderr, `kurmis setup: ${error.message}`);
    return EXIT_FAILURE;
  }
  let hadKurmis;
  try {
    hadKurmis = checkSetupSettingsFile(path, { port, key: readOrCreateKey() });
  } catch (error) {
    if (!(error instanceof SettingsFileError)) throw error;
    writeLine(context.stderr, `kurmis setup: ${error.message}`);
    return EXIT_FAILURE;
  }
  const key = await daemonStep(port, path, hadKurmis, deps, context);
  if (key === null) return EXIT_FAILURE;
  let result;
  try {
    result = setupSettingsFile(path, { port, key, credentialsOfItsOwn: configDirHasOwnCredentials(context.env, deps.platform) });
  } catch (error) {
    if (!(error instanceof SettingsFileError)) throw error;
    writeLine(context.stderr, `kurmis setup: ${error.message}`);
    return EXIT_FAILURE;
  }
  reportFile(result, false, context);
  if (clearPaused()) writeLine(context.stdout, "Global routing was paused; it is on again.");
  if (configDirHasOwnCredentials(context.env, deps.platform)) {
    writeLine(context.stdout, 'CLAUDE_CONFIG_DIR is set, so a claude that reads this file signs in with the login in that folder, not with the login plain claude uses, which is the one in ~/.claude. Kurmis sends the requests of such a claude only to the extra logins. "kurmis claude" still starts on the login plain claude uses.');
  }
  const ok3 = await autostartStep(false, deps, context);
  if (result.changed) {
    writeLine(context.stdout, "Claude Code sessions that are already open keep the settings they started with; start them again.");
  }
  if (!ok3) {
    writeLine(context.stderr, 'The settings file change above was made; run "kurmis setup" again to finish.');
    return EXIT_FAILURE;
  }
  return EXIT_OK;
}
async function runPause(deps, context) {
  const path = settingsPathOrFail(context);
  if (path === null) return EXIT_FAILURE;
  let result;
  try {
    result = undoSettingsFile(path, { port: portOrNull() });
  } catch (error) {
    if (!(error instanceof SettingsFileError)) throw error;
    writeLine(context.stderr, `kurmis setup: ${error.message}`);
    return EXIT_FAILURE;
  }
  const wasPaused = isPaused();
  if (!result.changed && !wasPaused) {
    reportFile(result, true, context);
    writeLine(context.stdout, 'Global routing is not on, so there is nothing to pause. "kurmis setup" turns it on.');
    return EXIT_OK;
  }
  reportFile(result, true, context);
  if (!wasPaused) markPaused();
  writeLine(context.stdout, wasPaused && !result.changed ? "Global routing is already paused." : "Paused global routing: a plain claude and the IDE extensions no longer go through kurmis.");
  writeLine(context.stdout, 'The daemon, its start at login, your logins and the settings backup stay. "kurmis setup" turns global routing on again.');
  if (result.changed) {
    writeLine(context.stdout, "Claude Code sessions that are already open keep the settings they started with, and so keep using kurmis until they end; start them again.");
  }
  if (await runningDaemonPid(deps, context) !== null) {
    writeLine(context.stdout, '"kurmis claude" still uses the daemon; "kurmis daemon stop" stops it.');
  }
  return EXIT_OK;
}
function loginsKurmisAdded(config) {
  const added = extraLogins(config).map((login) => ({
    login: { id: login.id, provider: login.provider, machineOwn: false },
    name: login.alias
  }));
  for (const provider of LOGIN_PROVIDERS) {
    let names;
    try {
      names = (0, import_node_fs26.readdirSync)(providerFolder(provider));
    } catch {
      continue;
    }
    for (const name of names) {
      if (!isLoginId(name) || findLogin(config, name)?.machineOwn === true) continue;
      if (added.some(({ login }) => login.id === name && login.provider === provider)) continue;
      added.push({ login: { id: name, provider, machineOwn: false }, name });
    }
  }
  return added;
}
function autostartEntry(platform) {
  if (platform === "darwin") return (0, import_node_fs26.existsSync)(autostartPlistPath()) ? autostartPlistPath() : null;
  if (platform === "win32") return `${RUN_ENTRY_DESCRIPTION}, if it is set`;
  return null;
}
function settingsHaveKurmis(path, port) {
  let text2;
  try {
    text2 = (0, import_node_fs26.readFileSync)(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  let backupText;
  try {
    backupText = (0, import_node_fs26.readFileSync)(backupPathFor(path), "utf8");
  } catch {
    backupText = null;
  }
  try {
    return undoSetupInText(text2, { port, backupText }).changed;
  } catch (error) {
    if (error instanceof SettingsFileError) throw new SettingsFileError(`${path} cannot be changed: ${error.message}`);
    throw error;
  }
}
function listLine(context, text2) {
  writeLine(context.stdout, `  - ${text2}`);
}
async function runUninstall(yes, deps, context) {
  const path = settingsPathOrFail(context);
  if (path === null) return EXIT_FAILURE;
  let config;
  let inSettings;
  try {
    config = loadConfig();
    inSettings = settingsHaveKurmis(path, config.port);
  } catch (error) {
    if (!(error instanceof ConfigError) && !(error instanceof SettingsFileError)) throw error;
    writeLine(context.stderr, `kurmis setup: ${error.message} Nothing was removed.`);
    return EXIT_FAILURE;
  }
  const logins = loginsKurmisAdded(config);
  const backup = backupPathFor(path);
  const hasBackup = (0, import_node_fs26.existsSync)(backup);
  const autostart = autostartEntry(deps.platform);
  const pid = await runningDaemonPid(deps, context);
  const dataFolder = kurmisHome();
  writeLine(context.stdout, "This removes what kurmis set up on this machine:");
  if (inSettings) listLine(context, `kurmis' settings in ${path}`);
  if (hasBackup) listLine(context, `${backup}, the copy of that file kurmis made`);
  if (autostart !== null) listLine(context, `the daemon's start at login (${autostart})`);
  listLine(context, logins.length === 0 ? "no logins: none was added to kurmis" : `the logins added to kurmis, each signed out first: ${logins.map(({ name }) => name).join(", ")}`);
  if (pid !== null) listLine(context, `the running daemon (pid ${String(pid)}), which is stopped`);
  if ((0, import_node_fs26.existsSync)(dataFolder)) listLine(context, `the kurmis data folder ${dataFolder}`);
  writeLine(context.stdout, 'The logins plain claude and plain codex use are not signed out, so a plain "claude" and "codex" keep working.');
  if (!yes) {
    if (!deps.stdinIsTerminal()) {
      writeLine(context.stderr, "kurmis setup: --uninstall-and-logout asks before it removes anything, and there is no terminal to ask at. Run it again with --yes to remove all of the above. Nothing was removed.");
      return EXIT_FAILURE;
    }
    const answer2 = await deps.ask("Remove all of this? [y/N] ", context);
    if (answer2 === null || !/^\s*y(es)?\s*$/i.test(answer2)) {
      writeLine(context.stdout, "Nothing was removed.");
      return EXIT_FAILURE;
    }
  }
  let result;
  try {
    result = undoSettingsFile(path, { port: config.port });
  } catch (error) {
    if (!(error instanceof SettingsFileError)) throw error;
    writeLine(context.stderr, `kurmis setup: ${error.message}`);
    writeLine(context.stderr, "Nothing else was removed, since Claude Code that reads the file still uses the daemon.");
    return EXIT_FAILURE;
  }
  reportFile(result, true, context);
  let failed2 = false;
  try {
    if ((0, import_node_fs26.existsSync)(backup)) {
      (0, import_node_fs26.rmSync)(backup, { force: true });
      writeLine(context.stdout, `Deleted ${backup}.`);
    }
  } catch (error) {
    writeLine(context.stderr, `Could not delete ${backup}: ${errorText4(error)}`);
    failed2 = true;
  }
  if (!await autostartStep(true, deps, context)) failed2 = true;
  let keepData = false;
  try {
    writeLine(context.stdout, await deps.stopDaemon({ env: context.env }) ? `Stopped the daemon${pid === null ? "" : ` (pid ${String(pid)})`}.` : "The daemon was not running.");
  } catch (error) {
    if (!(error instanceof DaemonError)) throw error;
    writeLine(context.stderr, `Could not stop the daemon: ${error.message}`);
    failed2 = true;
    keepData = true;
  }
  const notRemoved = [];
  for (const { login, name } of logins) {
    const code = await deps.logOutLogin(login, context, { keepFolderWhenSignOutFails: true, again: "kurmis setup --uninstall-and-logout" });
    if (code !== EXIT_OK) notRemoved.push(name);
  }
  if (notRemoved.length > 0) {
    writeLine(context.stderr, `Could not remove ${notRemoved.join(", ")}; see above.`);
    failed2 = true;
    keepData = true;
  }
  if (keepData) {
    writeLine(context.stderr, `Kept the kurmis data folder ${dataFolder}, which a second run needs to finish.`);
  } else {
    let removal = null;
    try {
      removal = removeDataFolder(deps.platform);
    } catch (error) {
      writeLine(context.stderr, `Could not delete the kurmis data folder ${dataFolder}: ${errorText4(error)}`);
      failed2 = true;
    }
    if (removal !== null && removal.removed) writeLine(context.stdout, `Deleted the kurmis data folder ${dataFolder}.`);
    if (removal !== null && !removal.removed) {
      writeLine(context.stdout, `Deleted kurmis' files in ${dataFolder}. The folder is left, because it also holds files kurmis did not write: ${removal.left.join(", ")}.`);
    }
  }
  if (result.changed) {
    writeLine(context.stdout, "Claude Code sessions that are already open keep the settings they started with and can no longer reach kurmis; start them again.");
  }
  if (failed2) {
    writeLine(context.stderr, 'Fix what is named above and run "kurmis setup --uninstall-and-logout" again to finish.');
    return EXIT_FAILURE;
  }
  writeLine(context.stdout, `Last step: remove the kurmis program with "${NPM_UNINSTALL}".`);
  return EXIT_OK;
}
async function askAtTerminal(question) {
  const lines = (0, import_promises6.createInterface)({ input: process.stdin, output: process.stdout });
  const controller = new AbortController();
  lines.on("SIGINT", () => controller.abort());
  lines.on("close", () => controller.abort());
  try {
    return await lines.question(question, { signal: controller.signal });
  } catch {
    return null;
  } finally {
    lines.close();
  }
}
function createSetupCommand(deps = {}) {
  const daemon = deps.daemon ?? realDaemonClient;
  const platform = deps.platform ?? process.platform;
  const full = {
    daemon,
    registerAutostart: deps.registerAutostart ?? registerAutostart,
    unregisterAutostart: deps.unregisterAutostart ?? unregisterAutostart,
    stopDaemon: deps.stopDaemon ?? stopDaemon,
    logOutLogin: deps.logOutLogin ?? createLoginLogout({ daemon, platform }),
    stdinIsTerminal: deps.stdinIsTerminal ?? (() => process.stdin.isTTY === true),
    ask: deps.ask ?? askAtTerminal,
    platform
  };
  return {
    name: "setup",
    summary: "Turn global routing on, pause it, or remove everything kurmis set up",
    usage: USAGE3,
    async run(args, context) {
      const parsed = parseCommandArgs("setup", args, {
        pause: { type: "boolean" },
        "uninstall-and-logout": { type: "boolean" },
        yes: { type: "boolean" }
      }, context);
      if (typeof parsed === "number") return parsed;
      const pause = parsed.values.pause === true;
      const uninstall = parsed.values["uninstall-and-logout"] === true;
      const yes = parsed.values.yes === true;
      if (pause && uninstall) return usageError("setup", "--pause and --uninstall-and-logout cannot be used together", context);
      if (yes && !uninstall) return usageError("setup", "--yes goes with --uninstall-and-logout", context);
      if (uninstall) return runUninstall(yes, full, context);
      return pause ? runPause(full, context) : runSetup(full, context);
    }
  };
}
var setupCommand = createSetupCommand();

// src/cli/status-format.ts
var STATUS_JSON_FORMAT = 2;
function statusJson(answer2, now, options) {
  return {
    format: STATUS_JSON_FORMAT,
    daemon: { version: answer2.version, pid: answer2.pid, port: answer2.port, startedAt: isoTime(answer2.startedAt) },
    logins: answer2.logins.map((login) => ({
      id: login.id,
      alias: login.alias,
      provider: login.provider,
      machineOwn: login.machineOwn,
      email: login.email ?? null,
      signedIn: login.signedIn,
      probing: login.probing === true,
      routing: login.routing,
      fiveHourLimit: login.fiveHourLimit,
      weeklyLimit: login.weeklyLimit,
      useFirst: login.useFirst,
      usage: login.usage === null ? null : usageJson(login, login.usage, now),
      blocked: blockJson(answer2, login, now, options),
      sessions: login.provider === "claude" ? login.sessions : null
    })),
    codexStart: codexStart(answer2, now),
    warnings: sameAccountWarnings(answer2)
  };
}
function loginArgument2(answer2, login) {
  const shared = answer2.logins.some((other) => other.id !== login.id && other.alias === login.alias);
  return shared ? `${login.provider}:${login.alias}` : login.alias;
}
function sameAccountWarnings(answer2) {
  const warnings = [];
  for (const own2 of answer2.logins.filter((login) => login.machineOwn && login.email !== null)) {
    const email = own2.email.trim().toLowerCase();
    for (const extra of answer2.logins) {
      if (extra.machineOwn || extra.provider !== own2.provider || extra.email?.trim().toLowerCase() !== email) continue;
      const product = PRODUCT_NAMES[own2.provider];
      warnings.push(`${extra.alias} and ${own2.alias}, the login plain ${own2.provider} uses, are the same ${product} account (${own2.email}), so they use one subscription. "kurmis logout ${loginArgument2(answer2, extra)}" removes ${extra.alias}.`);
    }
  }
  return warnings;
}
var PRODUCT_NAMES = { claude: "Claude", codex: "Codex" };
function formatStatus(answer2, now, options) {
  const json = statusJson(answer2, now, options);
  json.logins.forEach((login, index) => {
    const source = answer2.logins[index];
    const block = source === void 0 ? null : routeBlockOf(answer2, source, now);
    if (login.blocked !== null && block !== null) login.blocked.text = blockText(block, now, options, true);
  });
  const lines = [
    `kurmis daemon ${answer2.version}, pid ${String(answer2.pid)}, port ${String(answer2.port)}, running for ${spanText(now - answer2.startedAt)}`
  ];
  const labelWidth = Math.min(MAX_LABEL_WIDTH, Math.max(0, ...json.logins.flatMap((login) => (login.usage?.windows ?? []).map((window) => window.label.length))));
  for (const warning of json.warnings) lines.push("", ...wrap(`Warning: ${warning}`, "", "  "));
  for (const login of json.logins) {
    lines.push("", ...loginLines(login, now, labelWidth));
  }
  if (json.codexStart !== null) {
    lines.push("", ...wrap(`kurmis codex would start on ${json.codexStart.alias}.` + (json.codexStart.note === null ? "" : ` ${json.codexStart.note}`), "", ""));
  }
  return `${lines.join("\n")}
`;
}
var WIDTH = 80;
var MAX_LABEL_WIDTH = 24;
function loginLines(login, now, labelWidth) {
  const title = `${login.alias} (${PRODUCT_NAMES[login.provider]}, id ${login.id})`;
  const lines = login.email === null ? [title] : title.length + 2 + login.email.length <= WIDTH ? [`${title}  ${login.email}`] : [title, `  ${login.email}`];
  if (login.machineOwn) {
    lines.push(`  the login plain ${login.provider} uses`);
  }
  const facts = [
    login.signedIn === null ? "sign-in not checked yet" : login.signedIn ? "signed in" : "signed out",
    login.routing ? "routing on" : "routing off",
    `limits ${String(login.fiveHourLimit)}% 5 hour, ${String(login.weeklyLimit)}% weekly`
  ];
  if (login.useFirst) facts.push("use first");
  if (login.sessions !== null) facts.push(login.sessions === 1 ? "1 session" : `${String(login.sessions)} sessions`);
  if (login.usage?.plan) facts.push(`plan ${login.usage.plan}`);
  if (login.probing) facts.push("reading usage now");
  lines.push(...wrap(facts.join(", "), "  ", "  "));
  if (login.usage === null) {
    lines.push("  usage not read yet");
  } else {
    for (const window of login.usage.windows) lines.push(windowLine(window, now, labelWidth));
    if (login.usage.windows.length === 0) lines.push("  no usage windows reported");
    const age = now - Date.parse(login.usage.fetchedAt);
    const when = age < 6e4 ? "just now" : `${spanText(age)} ago`;
    lines.push(`  usage read ${when}${login.usage.source === "session" ? " from a forwarded answer" : ""}`);
    if (login.usage.error !== null) lines.push(...wrap(`last probe failed: ${login.usage.error}`, "  ", "    "));
  }
  if (login.blocked !== null && login.blocked.kind !== "auto-route-off" && login.blocked.kind !== "signed-out") {
    lines.push(...wrap(`passed over: ${login.blocked.text}`, "  ", "    "));
  }
  return lines;
}
function windowLine(window, now, labelWidth) {
  const label = window.label.length > labelWidth ? `${window.label.slice(0, labelWidth - 1)}~` : window.label;
  const percent = `${String(Math.round(window.utilization))}%`.padStart(4);
  const reset = windowHasReset(window, now) ? "reset since read" : resetsInText(window.resetsAt, now) ?? "";
  const limit = window.limitPercent === null ? "" : `limit ${String(window.limitPercent)}%`;
  return `  ${label.padEnd(labelWidth)}  ${percent}  ${reset.padEnd(20)}  ${limit}`.trimEnd();
}
function usageJson(login, usage, now) {
  const current = usageAsOf(usage, now);
  const planKeys = new Set(planUsageWindows(current).map((window) => window.key));
  const limits = { fiveHourLimitPercent: login.fiveHourLimit, weeklyLimitPercent: login.weeklyLimit };
  return {
    fetchedAt: isoTime(usage.fetchedAt),
    source: usage.source,
    plan: usage.subscriptionType,
    error: usage.error,
    windows: allUsageWindows(current).map((window) => {
      const plan = planKeys.has(window.key);
      return {
        key: window.key,
        label: window.label,
        durationMinutes: window.windowDurationMins ?? null,
        utilization: window.utilization,
        resetsAt: window.resetsAt,
        plan,
        limitPercent: plan ? limitForWindow(limits, window) : null
      };
    })
  };
}
function routeBlockOf(answer2, login, now) {
  return login.provider === "codex" ? codexRouteBlock(answer2, login.id, now) : login.block;
}
function blockJson(answer2, login, now, options) {
  const block = routeBlockOf(answer2, login, now);
  if (block === null) return null;
  let until = null;
  if (block.kind === "cooldown" && block.until !== null) until = isoTime(block.until);
  else if (block.kind === "over-limit") until = block.resetsAt;
  return { kind: block.kind, text: blockText(block, now, options, false), until };
}
function blockText(block, now, options, localTime) {
  if (block.kind === "cooldown" && block.until !== null) {
    const text3 = localTime ? `cooling down until ${localTimeText(block.until, now, options.timeZone)}` : routeBlockText(block, options.keychain);
    const left2 = resetsInText(block.until, now);
    return left2 === null ? text3 : `${text3} (${left2.replace("resets ", "")})`;
  }
  const text2 = routeBlockText(block, options.keychain);
  if (block.kind !== "over-limit") return text2;
  const left = resetsInText(block.resetsAt, now);
  return left === null ? text2 : `${text2}; it ${left}`;
}
function localTimeText(at2, now, timeZone) {
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  const parts = (time) => Object.fromEntries(format.formatToParts(time).map((part) => [part.type, part.value]));
  const then = parts(at2);
  const today = parts(now);
  const clock = `${then.hour ?? ""}:${then.minute ?? ""}`;
  const date = `${then.year ?? ""}-${then.month ?? ""}-${then.day ?? ""}`;
  return date === `${today.year ?? ""}-${today.month ?? ""}-${today.day ?? ""}` ? clock : `${date} ${clock}`;
}
function codexStart(answer2, now) {
  if (!answer2.logins.some((login) => login.provider === "codex")) return null;
  const choice = chooseCodexLogin(answer2, now);
  const alias = answer2.logins.find((login) => login.id === choice.login)?.alias ?? choice.login;
  return { login: choice.login, alias, note: choice.note };
}
function isoTime(at2) {
  return Number.isFinite(at2) ? new Date(at2).toISOString() : String(at2);
}
function wrap(text2, first, rest) {
  const lines = [];
  let line = first;
  let empty = true;
  for (const word of text2.split(" ")) {
    if (!empty && line.length + 1 + word.length > WIDTH) {
      lines.push(line);
      line = rest + word;
    } else {
      line += empty ? word : ` ${word}`;
    }
    empty = false;
  }
  lines.push(line);
  return lines;
}

// src/cli/commands/status.ts
var STATUS_PROBE_WAIT_MS = 15e3;
var USAGE4 = `Usage: kurmis status [--json]

Shows each login's five-hour and weekly usage, its limits, and whether routing can use it now.
The daemon is started first when it is not running.

Each login is shown by its alias, with its provider, its id and the account's email when the
daemon knows it. The login plain claude uses and the login plain codex uses are marked: they
are the accounts a plain "claude" and a plain "codex" are signed in to. When an extra Claude
login is the same account as the login plain claude uses, a warning says so, because both then
use one subscription. The same goes for Codex.

Options:
  --json       Print the same as JSON. Each login has "alias", "id", "provider" and
               "machineOwn"; "warnings" holds the warnings.
  -h, --help   Show this help.`;
function createStatusCommand(overrides = {}) {
  const deps = {
    daemon: realDaemonClient,
    now: Date.now,
    platform: process.platform,
    probeWaitMs: STATUS_PROBE_WAIT_MS,
    ...overrides
  };
  return {
    name: "status",
    summary: "Show each login's usage",
    usage: USAGE4,
    run: (args, context) => runStatus(args, context, deps)
  };
}
var statusCommand = createStatusCommand();
function nothingProbedYet(status2) {
  const signedIn = status2.logins.filter((login) => login.signedIn !== false);
  return signedIn.length > 0 && signedIn.every((login) => login.usage === null);
}
async function runStatus(args, context, deps) {
  const parsed = parseCommandArgs("status", args, { json: { type: "boolean" } }, context);
  if (typeof parsed === "number") return parsed;
  let status2;
  try {
    const connection = await deps.daemon.ensureDaemon({ env: context.env });
    status2 = await deps.daemon.readStatus(connection);
    if (nothingProbedYet(status2)) {
      const probed = await settleWithin((signal) => deps.daemon.requestProbe(connection, void 0, signal), deps.probeWaitMs);
      if (probed.kind === "done") {
        status2 = probed.value;
      } else {
        writeLine(context.stderr, probed.kind === "timeout" ? `kurmis status: the first usage probe did not finish within ${String(deps.probeWaitMs / 1e3)} s; showing what the daemon has.` : `kurmis status: the usage probe failed (${messageOf5(probed.error)}); showing what the daemon has.`);
      }
    }
  } catch (error) {
    writeLine(context.stderr, `kurmis status: the kurmis daemon could not be reached: ${messageOf5(error)}`);
    writeLine(context.stderr, 'Its log is daemon.log in the kurmis data folder; "kurmis daemon start" starts it.');
    return EXIT_FAILURE;
  }
  const now = deps.now();
  const options = { keychain: deps.platform === "darwin" };
  if (parsed.values.json === true) {
    writeLine(context.stdout, JSON.stringify(statusJson(status2, now, options), null, 2));
  } else {
    context.stdout.write(formatStatus(status2, now, options));
  }
  return EXIT_OK;
}
function messageOf5(error) {
  return error instanceof Error ? error.message : String(error);
}

// src/cli/commands/index.ts
var COMMANDS = [
  claudeCommand,
  codexCommand,
  statusCommand,
  listCommand,
  setCommand,
  loginCommand,
  logoutCommand,
  setupCommand,
  daemonCommand
];
function findCommand(name) {
  return COMMANDS.find((command) => command.name === name);
}

// src/cli/dispatch.ts
function mainHelp() {
  const width = Math.max(...COMMANDS.map((command) => command.name.length));
  const lines = COMMANDS.map((command) => `  ${command.name.padEnd(width)}  ${command.summary}`);
  return `kurmis ${kurmisVersion}: use several Claude Code and Codex logins on one machine.

Usage: kurmis <command> [options]

Commands:
${lines.join("\n")}
  ${"help".padEnd(width)}  Show the help of a command

Options:
  -h, --help     Show this help, or a command's help after its name.
  --version      Print the version.

Run "kurmis help <command>" for the options of a command.`;
}
async function runCli(argv, context) {
  const [first, ...rest] = argv;
  if (first === void 0 || isHelpFlag(first)) {
    writeLine(context.stdout, mainHelp());
    return EXIT_OK;
  }
  if (first === "--version") {
    writeLine(context.stdout, kurmisVersion);
    return EXIT_OK;
  }
  if (first === "help") return help(rest, context);
  const command = findCommand(first);
  if (command === void 0) {
    writeLine(context.stderr, first.startsWith("-") ? `kurmis: unknown option "${first}"` : `kurmis: unknown command "${first}"`);
    writeLine(context.stderr);
    writeLine(context.stderr, mainHelp());
    return EXIT_USAGE;
  }
  if (command.passesArguments !== true) {
    const beforeDashes = rest.includes("--") ? rest.slice(0, rest.indexOf("--")) : rest;
    if (beforeDashes.some(isHelpFlag)) {
      writeLine(context.stdout, command.usage);
      return EXIT_OK;
    }
  }
  return await command.run(rest, context);
}
function help(args, context) {
  const [name, ...extra] = args;
  if (name === void 0) {
    writeLine(context.stdout, mainHelp());
    return EXIT_OK;
  }
  const command = findCommand(name);
  if (command === void 0 || extra.length > 0) {
    writeLine(context.stderr, command === void 0 ? `kurmis help: unknown command "${name}"` : "kurmis help: takes one command name");
    writeLine(context.stderr);
    writeLine(context.stderr, mainHelp());
    return EXIT_USAGE;
  }
  writeLine(context.stdout, command.usage);
  return EXIT_OK;
}

// src/cli/main.ts
runCli(process.argv.slice(2), { stdout: process.stdout, stderr: process.stderr, env: process.env }).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    process.stderr.write(`kurmis: ${error instanceof Error ? error.message : String(error)}
`);
    process.exitCode = 1;
  }
);
