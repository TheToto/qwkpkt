"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HaxeEnum = void 0;
var HaxeEnum = (function () {
    function HaxeEnum(name, tag) {
        this.name = name;
        this.tag = tag;
    }
    HaxeEnum.getEnumConstructs = function () {
        throw new Error('getEnumConstructs must be implemented');
    };
    HaxeEnum.prototype.getParams = function () {
        throw new Error('getParams must be implemented');
    };
    return HaxeEnum;
}());
exports.HaxeEnum = HaxeEnum;
//# sourceMappingURL=HaxeEnum.js.map