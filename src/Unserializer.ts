import {Buffer} from 'buffer'
import {HaxeEnum} from "./HaxeEnum";

export interface TypeResolver {
    resolveClass: (name: string) => (new () => any)
    resolveEnum: (name: string) => typeof HaxeEnum
}

export class Unserializer {
    protected static classRegister: Record<string, new () => any> = {}
    protected static enumRegister: Record<string, typeof HaxeEnum> = {}
    protected static initialized: boolean = false;
    protected static DefaultResolver: TypeResolver = {
        resolveClass: (name) => {
            return Unserializer.classRegister[name];
        },
        resolveEnum: (name) => {
            return Unserializer.enumRegister[name];
        }
    }

    public static DEFAULT_RESOLVER: TypeResolver = Unserializer.DefaultResolver;

    /**
     * For security, classes will not be unserialized unless they
     * are registered as safe. Before unserializing, be sure to
     * register every class that could be in the serialized information.
     * ```
     * class Apple {}
     * let apple = new Apple();
     * Unserializer.register(Apple); // note the class name, not the instance
     * ```
     * @param clazz A class, not an instance or the string but the class name
     */
    public static registerSerializableClass(clazz: new () => any) {
        let name = clazz.name;
        if (name === undefined || name === null)
            throw new Error("Unable to get class name");
        if (name === "undefined" || name === "null" || name === "")
            throw new Error("Unable to register that as a serializable class");
        Unserializer.classRegister[name] = clazz;
    }

    public static registerSerializableEnum(enumz: typeof HaxeEnum) {
        let name = enumz.name;
        if (name === undefined || name === null)
            throw new Error("Unable to get enum name");
        if (name === "undefined" || name === "null" || name === "")
            throw new Error("Unable to register that as a serializable enum");
        Unserializer.enumRegister[name] = enumz;
    }

    /**
     * Register internal classes that are safe to unserialize
     */
    protected static initialize() {
        if (Unserializer.initialized) return;

        // todo: add any internal classes here

        Unserializer.initialized = true;
    }

    protected buf: string = "";
    protected pos: number = 0;
    protected length: number = 0;

    protected cache: Array<any> = [];
    protected scache: Array<string> = [];
    /**
     * The class resolver for the unserializer.
     * Defaults to {@link UnserializerDEFAULT_RESOLVER}, but
     * this can be changed for the current instance
     */
    public resolver: TypeResolver;

    constructor(s: string) {
        Unserializer.initialize();
        this.buf = s;
        this.length = s.length;
        let r = Unserializer.DEFAULT_RESOLVER;
        if (r === null || r === undefined) {
            r = Unserializer.DefaultResolver;
            Unserializer.DEFAULT_RESOLVER = r;
        }
        this.resolver = r;
    }

    protected isEof(c: number): boolean {
        return c !== c; // fast NaN
    }

    protected unserializeObject(o: any) {
        while (true) {
            if (this.pos >= this.length) {
                throw new Error("Invalid object");
            }
            if (this.buf.charCodeAt(this.pos) == 103) {
                break;
            }
            var k = this.unserialize();
            if (typeof (k) != "string") {
                throw new Error("Invalid object key");
            }
            var v = this.unserialize();
            o[k] = v;
        }
        this.pos++;
    }

    protected unserializeEnum(edecl: typeof HaxeEnum, tag: string | number): any {
        this.pos++; /* skip ':' */
        let constructs = edecl.getEnumConstructs();

        let enumClass;
        if (typeof tag == "number") {
            enumClass = constructs[tag];
        } else {
            enumClass = constructs.find((e: any) => e.name === tag);
        }
        if (enumClass == null)
            throw new Error("Unknown enum index/name : " + tag);
        let numArgs = this.readDigits();
        let args = Array(numArgs).fill(0).map(_ => this.unserialize());
        // @ts-ignore
        return new enumClass(...args);
    }

    protected readDigits(): number {
        var k = 0;
        var s = false;
        var fpos = this.pos;
        let get = this.buf.charCodeAt.bind(this.buf);
        while (true) {
            var c: number = get(this.pos);
            if (this.isEof(c))
                break;
            if (c === 45 /*"-"*/) {
                if (this.pos != fpos)
                    break;
                s = true;
                this.pos++;
                continue;
            }
            if (c < 48 /*"0"*/ || c > 57 /*"9"*/)
                break;
            k = k * 10 + (c - 48 /*"0"*/);
            this.pos++;
        }
        if (s)
            k *= -1;
        return k;
    }

    protected readFloat() {
        var p1 = this.pos;
        let get = this.buf.charCodeAt.bind(this.buf);
        while (true) {
            var c: number = get(this.pos);
            if (this.isEof(c))
                break;
            // + - . , 0-9
            if ((c >= 43 && c < 58) || c === 101 /*"e"*/ || c === 69 /*"E"*/)
                this.pos++;
            else
                break;
        }
        return parseFloat(this.buf.substr(p1, this.pos - p1));
    }

    public unserialize(): any {
        let err = (s: string) => {
            return new Error("Unserialization of " + s + " not implemented");
        }
        let get = this.buf.charCodeAt.bind(this.buf);
        switch (get(this.pos++)) {
            case 110: // "n" null
                return null;
            case 116: // "t" bool true
                return true;
            case 102: // "f" bool false
                return false;
            case 122: // "z" zero
                return 0;
            case 105: // "i" integer
                return this.readDigits();
            case 100: // "d" float
                return this.readFloat();
            case 121: // "y" string
                var len = this.readDigits();
                if (get(this.pos++) !== 58 /*":"*/ || this.length - this.pos < len)
                    throw new Error("Invalid string length");
                var s = this.buf.substr(this.pos, len);
                this.pos += len;
                s = decodeURIComponent(s);
                this.scache.push(s);
                return s;
            case 107: // "k" NaN
                return NaN;
            case 109: // "m"
                return Number.NEGATIVE_INFINITY;
            case 112: // "p"
                return Number.POSITIVE_INFINITY;
            case 97: // "a" Array
                var a = new Array<any>();
                this.cache.push(a);
                while (true) {
                    var c = get(this.pos);
                    if (c === 104 /* "h" */) {
                        this.pos++;
                        break;
                    }
                    if (c === 117 /* "u" */) {
                        this.pos++;
                        var n = this.readDigits();
                        a[a.length + n - 1] = null;
                    } else
                        a.push(this.unserialize());
                }
                return a;
            case 111: // "o" object
                var o = {};
                this.cache.push(o);
                this.unserializeObject(o);
                return o;
            case 114: // "r" class enum or structure reference
                var n = this.readDigits();
                if (n < 0 || n >= this.cache.length)
                    throw new Error("Invalid reference");
                return this.cache[n];
            case 82: // "R" string reference
                var n = this.readDigits();
                if (n < 0 || n >= this.scache.length)
                    throw new Error("Invalid string reference");
                return this.scache[n];
            case 120: // "x" throw an exception
                throw new Error(this.unserialize());
            case 99: // "c" class instance
                let cname = this.unserialize();
                let cli = this.resolver.resolveClass(cname);
                if (!cli)
                    throw new Error("Class not found " + cname);
                let co: any = Object.create(cli.prototype); // creates an empty instance, no constructor is called
                this.cache.push(co);
                this.unserializeObject(co);
                return co;
            case 119: // "w" enum instance by name
                let ename1 = this.unserialize();
                let edecl1 = this.resolver.resolveEnum(ename1);
                if (edecl1 == null)
                    throw new Error("Enum not found " + ename1);
                let e1 = this.unserializeEnum(edecl1, this.unserialize());
                this.cache.push(e1);
                this.pos++;
                return e1;
            case 106: // "j" enum instance by index
                let ename2 = this.unserialize();
                let edecl2 = this.resolver.resolveEnum(ename2);
                if (edecl2 == null)
                    throw new Error("Enum not found " + ename2);
                this.pos++; /* skip ':' */
                let index = this.readDigits();
                let e2 = this.unserializeEnum(edecl2, index);
                this.cache.push(e2);
                this.pos++;
                return e2;
            case 108: // "l" haxe list to javascript array
                var l = new Array();
                this.cache.push(l);
                while (get(this.pos) !== 104 /* "h" */)
                    l.push(this.unserialize());
                this.pos++;
                return l;
            case 98: // "b" string map
                var hsm: Record<string, any> = {};
                this.cache.push(hsm);
                while (get(this.pos) != 104 /* "h" */) {
                    var smt = this.unserialize();
                    hsm[smt] = this.unserialize();
                }
                this.pos++;
                return hsm;
            case 113: // "q" haxe int map
                let him: Record<number, any> = {};
                this.cache.push(him);
                var c = get(this.pos++);
                while (c === 58 /* ":" */) {
                    var i = this.readDigits();
                    him[i] = this.unserialize();
                    c = get(this.pos++);
                }
                if (c !== 104 /* "h" */)
                    throw new Error("Invalid IntMap format");
                return him;
            case 77: // "M" haxe object map
                var wm = new WeakMap();
                this.cache.push(wm);
                while (get(this.pos) !== 104 /* "h" */) {
                    var wms = this.unserialize();
                    wm.set(wms, this.unserialize());
                }
                this.pos++;
                return wm;
            case 118: // "v" Date
                let d: Date = new Date(this.readFloat());
                this.cache.push(d);
                return d;
            case 115: // "s" Buffers
                let bytesLen = this.readDigits();
                if (get(this.pos++) !== 58 /*":"*/ || this.length - this.pos < bytesLen)
                    throw new Error("Invalid bytes length");
                let bytes = Buffer.from(
                    this.buf.substr(this.pos, bytesLen)
                        .replace(/%/g, '+')
                        .replace(/:/g, '/'),
                    'base64');
                this.pos += bytesLen;
                this.cache.push(bytes);
                return bytes;
            case 67: // "C" custom
                let name = this.unserialize();
                let cl = this.resolver.resolveClass(name);
                if (cl == null)
                    throw new Error("Class not found " + name);
                let cclo: any = Object.create(cl.prototype); // creates an empty instance, no constructor is called
                this.cache.push(cclo);
                // if this throws, it is because the user had an '_qwkpktEncode' method, but no '_qwkpktDecode' method
                cclo._qwkpktDecode(this);
                if (get(this.pos++) !== 103 /*"g"*/)
                    throw new Error("Invalid custom data");
                return cclo;
            case 65: // "A" Class<Dynamic>
                // var name = this.unserialize();
                // var cl = resolver.resolveClass(name);
                // if (cl == null)
                // 	throw new Error("Class not found " + name);
                // return cl;
                throw err("classes");
            case 66: // "B" Enum<Dynamic>
                // var name = this.unserialize();
                // var e = resolver.resolveEnum(name);
                // if (e == null)
                // 	throw new Error("Enum not found " + name);
                // return e;
                throw err("enums");
            default:
        }
        this.pos--;
        throw (new Error("Invalid char " + get(this.pos) + " at position " + this.pos));
    }

}
