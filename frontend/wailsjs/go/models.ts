export namespace app {
	
	export class ApiResult_WNavicat_internal_model_ConnectionDO_ {
	    ok: boolean;
	    data: model.ConnectionDO;
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult_WNavicat_internal_model_ConnectionDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.ConnectionDO);
	        this.error = this.convertValues(source["error"], errno.AppError);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ApiResult_WNavicat_internal_model_DDLResultDO_ {
	    ok: boolean;
	    data: model.DDLResultDO;
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult_WNavicat_internal_model_DDLResultDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.DDLResultDO);
	        this.error = this.convertValues(source["error"], errno.AppError);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ApiResult_WNavicat_internal_model_ExportResultDO_ {
	    ok: boolean;
	    data: model.ExportResultDO;
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult_WNavicat_internal_model_ExportResultDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.ExportResultDO);
	        this.error = this.convertValues(source["error"], errno.AppError);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ApiResult_WNavicat_internal_model_QueryPageDO_ {
	    ok: boolean;
	    data: model.QueryPageDO;
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult_WNavicat_internal_model_QueryPageDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.QueryPageDO);
	        this.error = this.convertValues(source["error"], errno.AppError);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ApiResult_WNavicat_internal_model_SSHHostDO_ {
	    ok: boolean;
	    data: model.SSHHostDO;
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult_WNavicat_internal_model_SSHHostDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.SSHHostDO);
	        this.error = this.convertValues(source["error"], errno.AppError);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ApiResult_WNavicat_internal_model_SessionInfoDO_ {
	    ok: boolean;
	    data: model.SessionInfoDO;
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult_WNavicat_internal_model_SessionInfoDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.SessionInfoDO);
	        this.error = this.convertValues(source["error"], errno.AppError);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ApiResult_WNavicat_internal_model_TableDataPageDO_ {
	    ok: boolean;
	    data: model.TableDataPageDO;
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult_WNavicat_internal_model_TableDataPageDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.TableDataPageDO);
	        this.error = this.convertValues(source["error"], errno.AppError);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ApiResult_WNavicat_internal_model_TerminalSessionInfoDO_ {
	    ok: boolean;
	    data: model.TerminalSessionInfoDO;
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult_WNavicat_internal_model_TerminalSessionInfoDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.TerminalSessionInfoDO);
	        this.error = this.convertValues(source["error"], errno.AppError);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ApiResult_WNavicat_internal_model_VersionDO_ {
	    ok: boolean;
	    data: model.VersionDO;
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult_WNavicat_internal_model_VersionDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.VersionDO);
	        this.error = this.convertValues(source["error"], errno.AppError);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ApiResult___WNavicat_internal_model_ColumnMetaDO_ {
	    ok: boolean;
	    data: model.ColumnMetaDO[];
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult___WNavicat_internal_model_ColumnMetaDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.ColumnMetaDO);
	        this.error = this.convertValues(source["error"], errno.AppError);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ApiResult___WNavicat_internal_model_ConnectionDO_ {
	    ok: boolean;
	    data: model.ConnectionDO[];
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult___WNavicat_internal_model_ConnectionDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.ConnectionDO);
	        this.error = this.convertValues(source["error"], errno.AppError);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ApiResult___WNavicat_internal_model_ObjectTreeNodeDO_ {
	    ok: boolean;
	    data: model.ObjectTreeNodeDO[];
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult___WNavicat_internal_model_ObjectTreeNodeDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.ObjectTreeNodeDO);
	        this.error = this.convertValues(source["error"], errno.AppError);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ApiResult___WNavicat_internal_model_QueryHistoryDO_ {
	    ok: boolean;
	    data: model.QueryHistoryDO[];
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult___WNavicat_internal_model_QueryHistoryDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.QueryHistoryDO);
	        this.error = this.convertValues(source["error"], errno.AppError);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ApiResult___WNavicat_internal_model_SSHHostDO_ {
	    ok: boolean;
	    data: model.SSHHostDO[];
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult___WNavicat_internal_model_SSHHostDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.SSHHostDO);
	        this.error = this.convertValues(source["error"], errno.AppError);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ApiResult_bool_ {
	    ok: boolean;
	    data: boolean;
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult_bool_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = source["data"];
	        this.error = this.convertValues(source["error"], errno.AppError);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ApiResult_interface____ {
	    ok: boolean;
	    data: any;
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult_interface____(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = source["data"];
	        this.error = this.convertValues(source["error"], errno.AppError);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ExportCSVRequest {
	    fileName: string;
	    headers: string[];
	    rows: string[][];
	
	    static createFrom(source: any = {}) {
	        return new ExportCSVRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.fileName = source["fileName"];
	        this.headers = source["headers"];
	        this.rows = source["rows"];
	    }
	}

}

export namespace errno {
	
	export class AppError {
	    code: string;
	    message: string;
	    detail?: string;
	
	    static createFrom(source: any = {}) {
	        return new AppError(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.code = source["code"];
	        this.message = source["message"];
	        this.detail = source["detail"];
	    }
	}

}

export namespace model {
	
	export class CellValueDO {
	    value?: string;
	    isNull: boolean;
	    display: string;
	
	    static createFrom(source: any = {}) {
	        return new CellValueDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.value = source["value"];
	        this.isNull = source["isNull"];
	        this.display = source["display"];
	    }
	}
	export class ColumnMetaDO {
	    name: string;
	    dataType: string;
	    columnType: string;
	    nullable: boolean;
	    isPrimaryKey: boolean;
	    defaultValue?: string;
	    comment: string;
	    editable: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ColumnMetaDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.dataType = source["dataType"];
	        this.columnType = source["columnType"];
	        this.nullable = source["nullable"];
	        this.isPrimaryKey = source["isPrimaryKey"];
	        this.defaultValue = source["defaultValue"];
	        this.comment = source["comment"];
	        this.editable = source["editable"];
	    }
	}
	export class ConnectionDO {
	    id: string;
	    name: string;
	    dbType: string;
	    host: string;
	    port: number;
	    user: string;
	    password: string;
	    database: string;
	    charset: string;
	    sshEnabled: boolean;
	    sshHost: string;
	    sshPort: number;
	    sshUser: string;
	    sshKeyPath: string;
	    sshPassword: string;
	    createdAt: number;
	    updatedAt: number;
	
	    static createFrom(source: any = {}) {
	        return new ConnectionDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.dbType = source["dbType"];
	        this.host = source["host"];
	        this.port = source["port"];
	        this.user = source["user"];
	        this.password = source["password"];
	        this.database = source["database"];
	        this.charset = source["charset"];
	        this.sshEnabled = source["sshEnabled"];
	        this.sshHost = source["sshHost"];
	        this.sshPort = source["sshPort"];
	        this.sshUser = source["sshUser"];
	        this.sshKeyPath = source["sshKeyPath"];
	        this.sshPassword = source["sshPassword"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	    }
	}
	export class DDLResultDO {
	    content: string;
	
	    static createFrom(source: any = {}) {
	        return new DDLResultDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.content = source["content"];
	    }
	}
	export class ExportResultDO {
	    path: string;
	
	    static createFrom(source: any = {}) {
	        return new ExportResultDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	    }
	}
	export class FieldValueDO {
	    name: string;
	    value?: string;
	    isNull: boolean;
	
	    static createFrom(source: any = {}) {
	        return new FieldValueDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.value = source["value"];
	        this.isNull = source["isNull"];
	    }
	}
	export class ObjectTreeNodeDO {
	    id: string;
	    label: string;
	    nodeType: string;
	    database?: string;
	    table?: string;
	    children?: ObjectTreeNodeDO[];
	    lazy: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ObjectTreeNodeDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.label = source["label"];
	        this.nodeType = source["nodeType"];
	        this.database = source["database"];
	        this.table = source["table"];
	        this.children = this.convertValues(source["children"], ObjectTreeNodeDO);
	        this.lazy = source["lazy"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class QueryHistoryDO {
	    id: string;
	    connectionId: string;
	    database: string;
	    sql: string;
	    executedAt: number;
	    elapsedMs: number;
	    success: boolean;
	
	    static createFrom(source: any = {}) {
	        return new QueryHistoryDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.connectionId = source["connectionId"];
	        this.database = source["database"];
	        this.sql = source["sql"];
	        this.executedAt = source["executedAt"];
	        this.elapsedMs = source["elapsedMs"];
	        this.success = source["success"];
	    }
	}
	export class QueryRowDO {
	    cells: CellValueDO[];
	
	    static createFrom(source: any = {}) {
	        return new QueryRowDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.cells = this.convertValues(source["cells"], CellValueDO);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class QueryPageDO {
	    columns: ColumnMetaDO[];
	    rows: QueryRowDO[];
	    page: number;
	    pageSize: number;
	    total: number;
	    elapsedMs: number;
	
	    static createFrom(source: any = {}) {
	        return new QueryPageDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.columns = this.convertValues(source["columns"], ColumnMetaDO);
	        this.rows = this.convertValues(source["rows"], QueryRowDO);
	        this.page = source["page"];
	        this.pageSize = source["pageSize"];
	        this.total = source["total"];
	        this.elapsedMs = source["elapsedMs"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class RowMutationDO {
	    rowId: string;
	    fields: FieldValueDO[];
	    oldPk?: FieldValueDO[];
	
	    static createFrom(source: any = {}) {
	        return new RowMutationDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.rowId = source["rowId"];
	        this.fields = this.convertValues(source["fields"], FieldValueDO);
	        this.oldPk = this.convertValues(source["oldPk"], FieldValueDO);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class RowMutationBatchDO {
	    inserts: RowMutationDO[];
	    updates: RowMutationDO[];
	    deletes: RowMutationDO[];
	
	    static createFrom(source: any = {}) {
	        return new RowMutationBatchDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.inserts = this.convertValues(source["inserts"], RowMutationDO);
	        this.updates = this.convertValues(source["updates"], RowMutationDO);
	        this.deletes = this.convertValues(source["deletes"], RowMutationDO);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class SSHHostDO {
	    id: string;
	    name: string;
	    host: string;
	    port: number;
	    user: string;
	    password: string;
	    keyPath: string;
	    createdAt: number;
	    updatedAt: number;
	
	    static createFrom(source: any = {}) {
	        return new SSHHostDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.host = source["host"];
	        this.port = source["port"];
	        this.user = source["user"];
	        this.password = source["password"];
	        this.keyPath = source["keyPath"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	    }
	}
	export class SessionInfoDO {
	    sessionId: string;
	    connectionId: string;
	    database: string;
	
	    static createFrom(source: any = {}) {
	        return new SessionInfoDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sessionId = source["sessionId"];
	        this.connectionId = source["connectionId"];
	        this.database = source["database"];
	    }
	}
	export class TableRowDO {
	    rowId: string;
	    values: Record<string, CellValueDO>;
	
	    static createFrom(source: any = {}) {
	        return new TableRowDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.rowId = source["rowId"];
	        this.values = this.convertValues(source["values"], CellValueDO, true);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class TableDataPageDO {
	    columns: ColumnMetaDO[];
	    rows: TableRowDO[];
	    page: number;
	    pageSize: number;
	    total: number;
	    hasPrimaryKey: boolean;
	    readOnly: boolean;
	    elapsedMs: number;
	
	    static createFrom(source: any = {}) {
	        return new TableDataPageDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.columns = this.convertValues(source["columns"], ColumnMetaDO);
	        this.rows = this.convertValues(source["rows"], TableRowDO);
	        this.page = source["page"];
	        this.pageSize = source["pageSize"];
	        this.total = source["total"];
	        this.hasPrimaryKey = source["hasPrimaryKey"];
	        this.readOnly = source["readOnly"];
	        this.elapsedMs = source["elapsedMs"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class TableSortDO {
	    column: string;
	    ascending: boolean;
	
	    static createFrom(source: any = {}) {
	        return new TableSortDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.column = source["column"];
	        this.ascending = source["ascending"];
	    }
	}
	export class TableFilterDO {
	    enabled: boolean;
	    column: string;
	    operator: string;
	    value: string;
	
	    static createFrom(source: any = {}) {
	        return new TableFilterDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.enabled = source["enabled"];
	        this.column = source["column"];
	        this.operator = source["operator"];
	        this.value = source["value"];
	    }
	}
	export class TableDataQueryDO {
	    page: number;
	    pageSize: number;
	    filters: TableFilterDO[];
	    sorts: TableSortDO[];
	
	    static createFrom(source: any = {}) {
	        return new TableDataQueryDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.page = source["page"];
	        this.pageSize = source["pageSize"];
	        this.filters = this.convertValues(source["filters"], TableFilterDO);
	        this.sorts = this.convertValues(source["sorts"], TableSortDO);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	
	export class TerminalSessionInfoDO {
	    sessionId: string;
	    hostId: string;
	    title: string;
	    kind: string;
	
	    static createFrom(source: any = {}) {
	        return new TerminalSessionInfoDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sessionId = source["sessionId"];
	        this.hostId = source["hostId"];
	        this.title = source["title"];
	        this.kind = source["kind"];
	    }
	}
	export class VersionDO {
	    version: string;
	
	    static createFrom(source: any = {}) {
	        return new VersionDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.version = source["version"];
	    }
	}

}

