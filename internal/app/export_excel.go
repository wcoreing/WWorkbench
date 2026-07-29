package app

import (
	"fmt"
	"os"
	"strings"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
	"WWorkbench/internal/session"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"github.com/xuri/excelize/v2"
)

// ExportExcelRequest Excel 导出请求。
type ExportExcelRequest struct {
	FileName string     `json:"fileName"`
	Headers  []string   `json:"headers"`
	Rows     [][]string `json:"rows"`
}

// ExportExcel 导出 Excel 到用户选择路径。
func (s *Service) ExportExcel(req ExportExcelRequest) ApiResult[model.ExportResultDO] {
	path, err := runtime.SaveFileDialog(s.ctx, runtime.SaveDialogOptions{
		Title:           "导出 Excel",
		DefaultFilename: defaultExcelFileName(req.FileName),
		Filters:         []runtime.FileFilter{{DisplayName: "Excel", Pattern: "*.xlsx"}},
	})
	if err != nil {
		return ErrResult[model.ExportResultDO](err)
	}
	if path == "" {
		return OkResult(model.ExportResultDO{Path: ""})
	}
	if err := writeExcelFile(path, req.Headers, req.Rows); err != nil {
		return ErrResult[model.ExportResultDO](err)
	}
	return OkResult(model.ExportResultDO{Path: path})
}

// ExportTableExcel 导出 MySQL 表数据为 Excel（含筛选排序，最多 maxRows 行，columns 为空则导出全部字段）。
func (s *Service) ExportTableExcel(sessionID, database, table string, query model.TableDataQueryDO, maxRows int, columns []string) ApiResult[model.ExportResultDO] {
	if database == "" || table == "" {
		return ErrResult[model.ExportResultDO](errno.New(errno.CodeInvalidArg, "数据库和表名不能为空", ""))
	}
	if maxRows <= 0 || maxRows > 50000 {
		maxRows = 10000
	}
	ctx, cancel := session.WithTimeout(s.ctx, 120)
	defer cancel()
	query.Page = 1
	query.PageSize = maxRows
	page, err := s.table.GetTableDataPage(ctx, sessionID, database, table, query)
	if err != nil {
		return ErrResult[model.ExportResultDO](err)
	}
	headers, rows := tableDataPageToExcelRows(page, columns)
	path, err := runtime.SaveFileDialog(s.ctx, runtime.SaveDialogOptions{
		Title:           "导出 Excel",
		DefaultFilename: table + ".xlsx",
		Filters:         []runtime.FileFilter{{DisplayName: "Excel", Pattern: "*.xlsx"}},
	})
	if err != nil {
		return ErrResult[model.ExportResultDO](err)
	}
	if path == "" {
		return OkResult(model.ExportResultDO{Path: ""})
	}
	if err := writeExcelFile(path, headers, rows); err != nil {
		return ErrResult[model.ExportResultDO](err)
	}
	return OkResult(model.ExportResultDO{Path: path})
}

// defaultExcelFileName 确保默认文件名为 .xlsx。
func defaultExcelFileName(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return "export.xlsx"
	}
	if strings.HasSuffix(strings.ToLower(name), ".xlsx") {
		return name
	}
	if strings.Contains(name, ".") {
		return name
	}
	return name + ".xlsx"
}

// tableDataPageToExcelRows 将表数据分页转为 Excel 表头与行，columns 指定导出字段及顺序。
func tableDataPageToExcelRows(page *model.TableDataPageDO, columns []string) ([]string, [][]string) {
	if page == nil {
		return nil, nil
	}
	exportCols := pickExportColumns(page.Columns, columns)
	headers := make([]string, len(exportCols))
	for i, c := range exportCols {
		headers[i] = c.Name
	}
	rows := make([][]string, len(page.Rows))
	for i, row := range page.Rows {
		line := make([]string, len(exportCols))
		for j, col := range exportCols {
			cell, ok := row.Values[col.Name]
			if !ok || cell.IsNull {
				line[j] = ""
				continue
			}
			if cell.Display != "" {
				line[j] = cell.Display
				continue
			}
			if cell.Value != nil {
				line[j] = *cell.Value
			}
		}
		rows[i] = line
	}
	return headers, rows
}

// pickExportColumns 按指定字段名筛选列，保留 columns 中的顺序。
func pickExportColumns(all []model.ColumnMetaDO, columns []string) []model.ColumnMetaDO {
	if len(columns) == 0 {
		return all
	}
	colMap := make(map[string]model.ColumnMetaDO, len(all))
	for _, c := range all {
		colMap[c.Name] = c
	}
	out := make([]model.ColumnMetaDO, 0, len(columns))
	for _, name := range columns {
		if c, ok := colMap[name]; ok {
			out = append(out, c)
		}
	}
	return out
}

// writeExcelFile 写入 Excel 文件。
func writeExcelFile(path string, headers []string, rows [][]string) error {
	f := excelize.NewFile()
	defer f.Close()
	sheet := f.GetSheetName(0)
	if sheet == "" {
		sheet = "Sheet1"
	}
	colCount := len(headers)
	if colCount == 0 && len(rows) > 0 {
		colCount = len(rows[0])
	}
	for i, h := range headers {
		cell, err := excelize.CoordinatesToCellName(i+1, 1)
		if err != nil {
			return err
		}
		if err := f.SetCellValue(sheet, cell, h); err != nil {
			return err
		}
	}
	if len(headers) > 0 {
		endCol, err := excelize.CoordinatesToCellName(colCount, 1)
		if err != nil {
			return err
		}
		styleID, err := f.NewStyle(&excelize.Style{
			Font: &excelize.Font{Bold: true},
			Fill: excelize.Fill{Type: "pattern", Color: []string{"#E8EEF7"}, Pattern: 1},
		})
		if err != nil {
			return err
		}
		if err := f.SetCellStyle(sheet, "A1", endCol, styleID); err != nil {
			return err
		}
	}
	for ri, row := range rows {
		for ci, val := range row {
			cell, err := excelize.CoordinatesToCellName(ci+1, ri+2)
			if err != nil {
				return err
			}
			if err := f.SetCellValue(sheet, cell, val); err != nil {
				return err
			}
		}
	}
	if colCount > 0 {
		for i := 1; i <= colCount; i++ {
			col, err := excelize.ColumnNumberToName(i)
			if err != nil {
				return err
			}
			if err := f.SetColWidth(sheet, col, col, 16); err != nil {
				return fmt.Errorf("set col width: %w", err)
			}
		}
	}
	tmpPath := path
	if !strings.HasSuffix(strings.ToLower(path), ".xlsx") {
		tmpPath = path + ".xlsx"
	}
	if err := f.SaveAs(tmpPath); err != nil {
		return err
	}
	if tmpPath != path {
		if err := os.Rename(tmpPath, path); err != nil {
			return err
		}
	}
	return nil
}
