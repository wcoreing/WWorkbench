package app

import "WWorkbench/internal/errno"

// ApiResult 统一 API 响应。
type ApiResult[T any] struct {
	Ok    bool            `json:"ok"`
	Data  T               `json:"data"`
	Error *errno.AppError `json:"error,omitempty"`
}

// OkResult 成功响应。
func OkResult[T any](data T) ApiResult[T] {
	return ApiResult[T]{Ok: true, Data: data}
}

// ErrResult 失败响应。
func ErrResult[T any](err error) ApiResult[T] {
	if ae, ok := err.(*errno.AppError); ok {
		return ApiResult[T]{Ok: false, Error: ae}
	}
	return ApiResult[T]{Ok: false, Error: errno.New(errno.CodeUnknown, err.Error(), "")}
}
