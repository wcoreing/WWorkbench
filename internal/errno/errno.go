package errno

import (
	"errors"
	"fmt"
	"strings"
)

// Code 业务错误码。
type Code string

const (
	CodeUnknown       Code = "UNKNOWN"
	CodeInvalidArg    Code = "INVALID_ARG"
	CodeNotFound      Code = "NOT_FOUND"
	CodeConnFailed    Code = "CONN_FAILED"
	CodeSessionClosed Code = "SESSION_CLOSED"
	CodeSQLFailed     Code = "SQL_FAILED"
	CodeMutationFailed Code = "MUTATION_FAILED"
	CodeReadOnlyTable Code = "READ_ONLY_TABLE"
	CodeStoreFailed   Code = "STORE_FAILED"
	CodeSSHHostUnknown Code = "SSH_HOST_UNKNOWN"
	CodeCancelled      Code = "CANCELLED"
)

// AppError 统一业务错误。
type AppError struct {
	Code    Code   `json:"code"`
	Message string `json:"message"`
	Detail  string `json:"detail,omitempty"`
}

func (e *AppError) Error() string {
	if e.Detail != "" {
		return fmt.Sprintf("%s: %s (%s)", e.Code, e.Message, e.Detail)
	}
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

// New 创建业务错误。
func New(code Code, message, detail string) *AppError {
	return &AppError{Code: code, Message: message, Detail: detail}
}

// Wrap 包装底层错误。
func Wrap(code Code, message string, err error) *AppError {
	if err == nil {
		return New(code, message, "")
	}
	if ae := Extract(err); ae != nil {
		return ae
	}
	return New(code, message, err.Error())
}

// Extract 从错误链中提取业务错误（含 SSH 握手包装场景）。
func Extract(err error) *AppError {
	if err == nil {
		return nil
	}
	var ae *AppError
	if errors.As(err, &ae) {
		return ae
	}
	return parseEmbedded(err.Error())
}

// parseEmbedded 从错误文本解析内嵌的业务错误码。
func parseEmbedded(msg string) *AppError {
	marker := string(CodeSSHHostUnknown) + ":"
	idx := strings.Index(msg, marker)
	if idx < 0 {
		return nil
	}
	rest := strings.TrimSpace(msg[idx+len(marker):])
	message := rest
	detail := ""
	if open := strings.LastIndex(rest, " ("); open > 0 && strings.HasSuffix(rest, ")") {
		message = strings.TrimSpace(rest[:open])
		detail = rest[open+2 : len(rest)-1]
	}
	return New(CodeSSHHostUnknown, message, detail)
}
