export namespace app {
	
	export class ApiResult_WNavicat_internal_model_ComposeLogsDO_ {
	    ok: boolean;
	    data: model.ComposeLogsDO;
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult_WNavicat_internal_model_ComposeLogsDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.ComposeLogsDO);
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
	export class ApiResult_WNavicat_internal_model_ContainerDO_ {
	    ok: boolean;
	    data: model.ContainerDO;
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult_WNavicat_internal_model_ContainerDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.ContainerDO);
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
	export class ApiResult_WNavicat_internal_model_ContainerDatabaseLinkDO_ {
	    ok: boolean;
	    data: model.ContainerDatabaseLinkDO;
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult_WNavicat_internal_model_ContainerDatabaseLinkDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.ContainerDatabaseLinkDO);
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
	export class ApiResult_WNavicat_internal_model_ContainerEnvDO_ {
	    ok: boolean;
	    data: model.ContainerEnvDO;
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult_WNavicat_internal_model_ContainerEnvDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.ContainerEnvDO);
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
	export class ApiResult_WNavicat_internal_model_ContainerLogsDO_ {
	    ok: boolean;
	    data: model.ContainerLogsDO;
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult_WNavicat_internal_model_ContainerLogsDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.ContainerLogsDO);
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
	export class ApiResult_WNavicat_internal_model_ContainerRunPresetDO_ {
	    ok: boolean;
	    data: model.ContainerRunPresetDO;
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult_WNavicat_internal_model_ContainerRunPresetDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.ContainerRunPresetDO);
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
	export class ApiResult_WNavicat_internal_model_ContainerShellDO_ {
	    ok: boolean;
	    data: model.ContainerShellDO;
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult_WNavicat_internal_model_ContainerShellDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.ContainerShellDO);
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
	export class ApiResult_WNavicat_internal_model_DockerContextDO_ {
	    ok: boolean;
	    data: model.DockerContextDO;
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult_WNavicat_internal_model_DockerContextDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.DockerContextDO);
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
	export class ApiResult_WNavicat_internal_model_EnvApplyResultDO_ {
	    ok: boolean;
	    data: model.EnvApplyResultDO;
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult_WNavicat_internal_model_EnvApplyResultDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.EnvApplyResultDO);
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
	export class ApiResult_WNavicat_internal_model_EnvPresetDO_ {
	    ok: boolean;
	    data: model.EnvPresetDO;
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult_WNavicat_internal_model_EnvPresetDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.EnvPresetDO);
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
	export class ApiResult_WNavicat_internal_model_LocalDirResultDO_ {
	    ok: boolean;
	    data: model.LocalDirResultDO;
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult_WNavicat_internal_model_LocalDirResultDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.LocalDirResultDO);
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
	export class ApiResult_WNavicat_internal_model_NoteDO_ {
	    ok: boolean;
	    data: model.NoteDO;
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult_WNavicat_internal_model_NoteDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.NoteDO);
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
	export class ApiResult_WNavicat_internal_model_NotebookGroupDO_ {
	    ok: boolean;
	    data: model.NotebookGroupDO;
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult_WNavicat_internal_model_NotebookGroupDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.NotebookGroupDO);
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
	export class ApiResult_WNavicat_internal_model_NotebookUIDO_ {
	    ok: boolean;
	    data: model.NotebookUIDO;
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult_WNavicat_internal_model_NotebookUIDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.NotebookUIDO);
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
	export class ApiResult_WNavicat_internal_model_SFTPSessionInfoDO_ {
	    ok: boolean;
	    data: model.SFTPSessionInfoDO;
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult_WNavicat_internal_model_SFTPSessionInfoDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.SFTPSessionInfoDO);
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
	export class ApiResult_WNavicat_internal_model_SftpBookmarkDO_ {
	    ok: boolean;
	    data: model.SftpBookmarkDO;
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult_WNavicat_internal_model_SftpBookmarkDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.SftpBookmarkDO);
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
	export class ApiResult_WNavicat_internal_model_TransferConflictDO_ {
	    ok: boolean;
	    data: model.TransferConflictDO;
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult_WNavicat_internal_model_TransferConflictDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.TransferConflictDO);
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
	export class ApiResult_WNavicat_internal_model_TransferResultDO_ {
	    ok: boolean;
	    data: model.TransferResultDO;
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult_WNavicat_internal_model_TransferResultDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.TransferResultDO);
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
	export class ApiResult___WNavicat_internal_model_ComposeServiceDO_ {
	    ok: boolean;
	    data: model.ComposeServiceDO[];
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult___WNavicat_internal_model_ComposeServiceDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.ComposeServiceDO);
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
	export class ApiResult___WNavicat_internal_model_ContainerDO_ {
	    ok: boolean;
	    data: model.ContainerDO[];
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult___WNavicat_internal_model_ContainerDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.ContainerDO);
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
	export class ApiResult___WNavicat_internal_model_DockerContextDO_ {
	    ok: boolean;
	    data: model.DockerContextDO[];
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult___WNavicat_internal_model_DockerContextDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.DockerContextDO);
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
	export class ApiResult___WNavicat_internal_model_DockerImageDO_ {
	    ok: boolean;
	    data: model.DockerImageDO[];
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult___WNavicat_internal_model_DockerImageDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.DockerImageDO);
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
	export class ApiResult___WNavicat_internal_model_EnvPresetDO_ {
	    ok: boolean;
	    data: model.EnvPresetDO[];
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult___WNavicat_internal_model_EnvPresetDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.EnvPresetDO);
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
	export class ApiResult___WNavicat_internal_model_FileEntryDO_ {
	    ok: boolean;
	    data: model.FileEntryDO[];
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult___WNavicat_internal_model_FileEntryDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.FileEntryDO);
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
	export class ApiResult___WNavicat_internal_model_IndexMetaDO_ {
	    ok: boolean;
	    data: model.IndexMetaDO[];
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult___WNavicat_internal_model_IndexMetaDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.IndexMetaDO);
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
	export class ApiResult___WNavicat_internal_model_NoteSummaryDO_ {
	    ok: boolean;
	    data: model.NoteSummaryDO[];
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult___WNavicat_internal_model_NoteSummaryDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.NoteSummaryDO);
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
	export class ApiResult___WNavicat_internal_model_NotebookGroupDO_ {
	    ok: boolean;
	    data: model.NotebookGroupDO[];
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult___WNavicat_internal_model_NotebookGroupDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.NotebookGroupDO);
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
	export class ApiResult___WNavicat_internal_model_ProjectEnvHintDO_ {
	    ok: boolean;
	    data: model.ProjectEnvHintDO[];
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult___WNavicat_internal_model_ProjectEnvHintDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.ProjectEnvHintDO);
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
	export class ApiResult___WNavicat_internal_model_RuntimeDO_ {
	    ok: boolean;
	    data: model.RuntimeDO[];
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult___WNavicat_internal_model_RuntimeDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.RuntimeDO);
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
	export class ApiResult___WNavicat_internal_model_RuntimeVersionDO_ {
	    ok: boolean;
	    data: model.RuntimeVersionDO[];
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult___WNavicat_internal_model_RuntimeVersionDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.RuntimeVersionDO);
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
	export class ApiResult___WNavicat_internal_model_SftpBookmarkDO_ {
	    ok: boolean;
	    data: model.SftpBookmarkDO[];
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult___WNavicat_internal_model_SftpBookmarkDO_(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.data = this.convertValues(source["data"], model.SftpBookmarkDO);
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
	export class ApiResult_int_ {
	    ok: boolean;
	    data: number;
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult_int_(source);
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
	export class ApiResult_map_string_string_ {
	    ok: boolean;
	    data: Record<string, string>;
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult_map_string_string_(source);
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
	export class ApiResult_string_ {
	    ok: boolean;
	    data: string;
	    error?: errno.AppError;
	
	    static createFrom(source: any = {}) {
	        return new ApiResult_string_(source);
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
	    extra: string;
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
	        this.extra = source["extra"];
	        this.defaultValue = source["defaultValue"];
	        this.comment = source["comment"];
	        this.editable = source["editable"];
	    }
	}
	export class ComposeLogsDO {
	    content: string;
	
	    static createFrom(source: any = {}) {
	        return new ComposeLogsDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.content = source["content"];
	    }
	}
	export class ComposeServiceDO {
	    name: string;
	    service: string;
	    image: string;
	    state: string;
	    status: string;
	    ports: string;
	    containerId: string;
	
	    static createFrom(source: any = {}) {
	        return new ComposeServiceDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.service = source["service"];
	        this.image = source["image"];
	        this.state = source["state"];
	        this.status = source["status"];
	        this.ports = source["ports"];
	        this.containerId = source["containerId"];
	    }
	}
	export class ConnectionDO {
	    id: string;
	    name: string;
	    group: string;
	    dbType: string;
	    host: string;
	    port: number;
	    user: string;
	    password: string;
	    database: string;
	    charset: string;
	    sshEnabled: boolean;
	    sshHostId: string;
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
	        this.group = source["group"];
	        this.dbType = source["dbType"];
	        this.host = source["host"];
	        this.port = source["port"];
	        this.user = source["user"];
	        this.password = source["password"];
	        this.database = source["database"];
	        this.charset = source["charset"];
	        this.sshEnabled = source["sshEnabled"];
	        this.sshHostId = source["sshHostId"];
	        this.sshHost = source["sshHost"];
	        this.sshPort = source["sshPort"];
	        this.sshUser = source["sshUser"];
	        this.sshKeyPath = source["sshKeyPath"];
	        this.sshPassword = source["sshPassword"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	    }
	}
	export class ContainerDO {
	    id: string;
	    shortId: string;
	    name: string;
	    image: string;
	    state: string;
	    status: string;
	    ports: string;
	    createdAt: number;
	
	    static createFrom(source: any = {}) {
	        return new ContainerDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.shortId = source["shortId"];
	        this.name = source["name"];
	        this.image = source["image"];
	        this.state = source["state"];
	        this.status = source["status"];
	        this.ports = source["ports"];
	        this.createdAt = source["createdAt"];
	    }
	}
	export class ContainerDatabaseLinkDO {
	    dbType: string;
	    name: string;
	    host: string;
	    port: number;
	    user: string;
	    password: string;
	    database: string;
	    sshEnabled: boolean;
	    sshHostId: string;
	
	    static createFrom(source: any = {}) {
	        return new ContainerDatabaseLinkDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.dbType = source["dbType"];
	        this.name = source["name"];
	        this.host = source["host"];
	        this.port = source["port"];
	        this.user = source["user"];
	        this.password = source["password"];
	        this.database = source["database"];
	        this.sshEnabled = source["sshEnabled"];
	        this.sshHostId = source["sshHostId"];
	    }
	}
	export class ContainerEnvVarDO {
	    key: string;
	    value: string;
	    highlight: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ContainerEnvVarDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.value = source["value"];
	        this.highlight = source["highlight"];
	    }
	}
	export class ContainerEnvDO {
	    vars: ContainerEnvVarDO[];
	
	    static createFrom(source: any = {}) {
	        return new ContainerEnvDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.vars = this.convertValues(source["vars"], ContainerEnvVarDO);
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
	export class ContainerEnvKVDO {
	    key: string;
	    value: string;
	
	    static createFrom(source: any = {}) {
	        return new ContainerEnvKVDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.value = source["value"];
	    }
	}
	
	export class ContainerLogsDO {
	    content: string;
	
	    static createFrom(source: any = {}) {
	        return new ContainerLogsDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.content = source["content"];
	    }
	}
	export class ContainerPortMappingDO {
	    hostPort: number;
	    containerPort: number;
	    protocol: string;
	
	    static createFrom(source: any = {}) {
	        return new ContainerPortMappingDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hostPort = source["hostPort"];
	        this.containerPort = source["containerPort"];
	        this.protocol = source["protocol"];
	    }
	}
	export class ContainerRunDO {
	    image: string;
	    name: string;
	    ports: ContainerPortMappingDO[];
	    env: ContainerEnvKVDO[];
	    restart: string;
	    autoStart: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ContainerRunDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.image = source["image"];
	        this.name = source["name"];
	        this.ports = this.convertValues(source["ports"], ContainerPortMappingDO);
	        this.env = this.convertValues(source["env"], ContainerEnvKVDO);
	        this.restart = source["restart"];
	        this.autoStart = source["autoStart"];
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
	export class ContainerRunEnvFieldDO {
	    key: string;
	    placeholder: string;
	    required: boolean;
	    secret: boolean;
	    default: string;
	
	    static createFrom(source: any = {}) {
	        return new ContainerRunEnvFieldDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.placeholder = source["placeholder"];
	        this.required = source["required"];
	        this.secret = source["secret"];
	        this.default = source["default"];
	    }
	}
	export class ContainerRunPresetDO {
	    image: string;
	    name: string;
	    ports: ContainerPortMappingDO[];
	    envFields: ContainerRunEnvFieldDO[];
	    restart: string;
	
	    static createFrom(source: any = {}) {
	        return new ContainerRunPresetDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.image = source["image"];
	        this.name = source["name"];
	        this.ports = this.convertValues(source["ports"], ContainerPortMappingDO);
	        this.envFields = this.convertValues(source["envFields"], ContainerRunEnvFieldDO);
	        this.restart = source["restart"];
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
	export class ContainerShellDO {
	    mode: string;
	    hostId: string;
	    command: string;
	
	    static createFrom(source: any = {}) {
	        return new ContainerShellDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.mode = source["mode"];
	        this.hostId = source["hostId"];
	        this.command = source["command"];
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
	export class DockerContextDO {
	    id: string;
	    name: string;
	    kind: string;
	    endpoint: string;
	    sshHostId: string;
	    connected: boolean;
	
	    static createFrom(source: any = {}) {
	        return new DockerContextDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.kind = source["kind"];
	        this.endpoint = source["endpoint"];
	        this.sshHostId = source["sshHostId"];
	        this.connected = source["connected"];
	    }
	}
	export class DockerImageDO {
	    id: string;
	    shortId: string;
	    tags: string;
	    size: number;
	    createdAt: number;
	
	    static createFrom(source: any = {}) {
	        return new DockerImageDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.shortId = source["shortId"];
	        this.tags = source["tags"];
	        this.size = source["size"];
	        this.createdAt = source["createdAt"];
	    }
	}
	export class EnvApplyResultDO {
	    warnings: string[];
	
	    static createFrom(source: any = {}) {
	        return new EnvApplyResultDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.warnings = source["warnings"];
	    }
	}
	export class EnvPresetDO {
	    id: string;
	    name: string;
	    active: boolean;
	    runtimes: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new EnvPresetDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.active = source["active"];
	        this.runtimes = source["runtimes"];
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
	export class FileEntryDO {
	    name: string;
	    path: string;
	    isDir: boolean;
	    size: number;
	    modTime: number;
	
	    static createFrom(source: any = {}) {
	        return new FileEntryDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.isDir = source["isDir"];
	        this.size = source["size"];
	        this.modTime = source["modTime"];
	    }
	}
	export class IndexMetaDO {
	    name: string;
	    column: string;
	    nonUnique: boolean;
	    seqInIndex: number;
	    indexType: string;
	
	    static createFrom(source: any = {}) {
	        return new IndexMetaDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.column = source["column"];
	        this.nonUnique = source["nonUnique"];
	        this.seqInIndex = source["seqInIndex"];
	        this.indexType = source["indexType"];
	    }
	}
	export class LocalDirResultDO {
	    path: string;
	    entries: FileEntryDO[];
	
	    static createFrom(source: any = {}) {
	        return new LocalDirResultDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.entries = this.convertValues(source["entries"], FileEntryDO);
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
	export class NoteDO {
	    id: string;
	    groupId: string;
	    title: string;
	    content: string;
	    language: string;
	    sshHostId: string;
	    connectionId: string;
	    sortOrder: number;
	    createdAt: number;
	    updatedAt: number;
	
	    static createFrom(source: any = {}) {
	        return new NoteDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.groupId = source["groupId"];
	        this.title = source["title"];
	        this.content = source["content"];
	        this.language = source["language"];
	        this.sshHostId = source["sshHostId"];
	        this.connectionId = source["connectionId"];
	        this.sortOrder = source["sortOrder"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	    }
	}
	export class NoteSummaryDO {
	    id: string;
	    groupId: string;
	    title: string;
	    language: string;
	    sshHostId: string;
	    connectionId: string;
	    sortOrder: number;
	    updatedAt: number;
	
	    static createFrom(source: any = {}) {
	        return new NoteSummaryDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.groupId = source["groupId"];
	        this.title = source["title"];
	        this.language = source["language"];
	        this.sshHostId = source["sshHostId"];
	        this.connectionId = source["connectionId"];
	        this.sortOrder = source["sortOrder"];
	        this.updatedAt = source["updatedAt"];
	    }
	}
	export class NotebookGroupDO {
	    id: string;
	    name: string;
	    parentId: string;
	    sortOrder: number;
	    createdAt: number;
	    updatedAt: number;
	
	    static createFrom(source: any = {}) {
	        return new NotebookGroupDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.parentId = source["parentId"];
	        this.sortOrder = source["sortOrder"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	    }
	}
	export class NotebookUIDO {
	    openTabIds: string[];
	    activeTabId: string;
	
	    static createFrom(source: any = {}) {
	        return new NotebookUIDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.openTabIds = source["openTabIds"];
	        this.activeTabId = source["activeTabId"];
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
	export class ProjectEnvHintDO {
	    path: string;
	    hints: string[];
	    suggested: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new ProjectEnvHintDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.hints = source["hints"];
	        this.suggested = source["suggested"];
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
	
	export class RuntimeDO {
	    lang: string;
	    label: string;
	    version: string;
	    manager: string;
	    managerLabel: string;
	    binary: string;
	    available: boolean;
	    canInstall: boolean;
	    needsManager: boolean;
	    canInstallManager: boolean;
	
	    static createFrom(source: any = {}) {
	        return new RuntimeDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.lang = source["lang"];
	        this.label = source["label"];
	        this.version = source["version"];
	        this.manager = source["manager"];
	        this.managerLabel = source["managerLabel"];
	        this.binary = source["binary"];
	        this.available = source["available"];
	        this.canInstall = source["canInstall"];
	        this.needsManager = source["needsManager"];
	        this.canInstallManager = source["canInstallManager"];
	    }
	}
	export class RuntimeVersionDO {
	    version: string;
	    label: string;
	    formula: string;
	    installed: boolean;
	    active: boolean;
	
	    static createFrom(source: any = {}) {
	        return new RuntimeVersionDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.version = source["version"];
	        this.label = source["label"];
	        this.formula = source["formula"];
	        this.installed = source["installed"];
	        this.active = source["active"];
	    }
	}
	export class SFTPSessionInfoDO {
	    sessionId: string;
	    hostId: string;
	    title: string;
	
	    static createFrom(source: any = {}) {
	        return new SFTPSessionInfoDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sessionId = source["sessionId"];
	        this.hostId = source["hostId"];
	        this.title = source["title"];
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
	export class SftpBookmarkDO {
	    id: string;
	    side: string;
	    hostId: string;
	    name: string;
	    path: string;
	    createdAt: number;
	
	    static createFrom(source: any = {}) {
	        return new SftpBookmarkDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.side = source["side"];
	        this.hostId = source["hostId"];
	        this.name = source["name"];
	        this.path = source["path"];
	        this.createdAt = source["createdAt"];
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
	export class TransferConflictDO {
	    hasConflict: boolean;
	    name: string;
	    sourcePath: string;
	    sourceSize: number;
	    sourceModTime: number;
	    sourceIsDir: boolean;
	    targetPath: string;
	    targetSize: number;
	    targetModTime: number;
	    targetIsDir: boolean;
	
	    static createFrom(source: any = {}) {
	        return new TransferConflictDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hasConflict = source["hasConflict"];
	        this.name = source["name"];
	        this.sourcePath = source["sourcePath"];
	        this.sourceSize = source["sourceSize"];
	        this.sourceModTime = source["sourceModTime"];
	        this.sourceIsDir = source["sourceIsDir"];
	        this.targetPath = source["targetPath"];
	        this.targetSize = source["targetSize"];
	        this.targetModTime = source["targetModTime"];
	        this.targetIsDir = source["targetIsDir"];
	    }
	}
	export class TransferResultDO {
	    path: string;
	
	    static createFrom(source: any = {}) {
	        return new TransferResultDO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
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

