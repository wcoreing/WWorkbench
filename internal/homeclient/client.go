package homeclient

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Client 访问远端 wwb-home（账号服务）。
type Client struct {
	BaseURL string
	Token   string
	HTTP    *http.Client
}

func New(baseURL, token string) *Client {
	if strings.TrimSpace(baseURL) == "" {
		baseURL = ResolveBaseURL()
	}
	return &Client{
		BaseURL: strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		Token:   strings.TrimSpace(token),
		HTTP: &http.Client{
			Timeout: 180 * time.Second,
			// 自行处理 gzip，便于统计压缩体积并兼容旧服务端
			Transport: &http.Transport{DisableCompression: true},
		},
	}
}

func (c *Client) do(method, path string, body any, out any) error {
	if body == nil {
		return c.doBytes(method, path, nil, false, out)
	}
	b, err := json.Marshal(body)
	if err != nil {
		return err
	}
	return c.doBytes(method, path, b, false, out)
}

func (c *Client) doBytes(method, path string, body []byte, gzipBody bool, out any) error {
	_, _, err := c.doBytesEx(method, path, body, gzipBody, out)
	return err
}

func (c *Client) doBytesEx(method, path string, body []byte, gzipBody bool, out any) (rawBytes, wireBytes int64, err error) {
	if c == nil || c.BaseURL == "" {
		return 0, 0, fmt.Errorf("账号服务地址未配置")
	}
	rawBytes = int64(len(body))
	payload := body
	if gzipBody && len(body) > 0 {
		var buf bytes.Buffer
		gz := gzip.NewWriter(&buf)
		if _, werr := gz.Write(body); werr != nil {
			return 0, 0, werr
		}
		if cerr := gz.Close(); cerr != nil {
			return 0, 0, cerr
		}
		payload = buf.Bytes()
	}
	wireBytes = int64(len(payload))

	var rdr io.Reader
	if payload != nil {
		rdr = bytes.NewReader(payload)
	}
	req, err := http.NewRequest(method, c.BaseURL+path, rdr)
	if err != nil {
		return 0, 0, err
	}
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
		if gzipBody {
			req.Header.Set("Content-Encoding", "gzip")
		}
	}
	req.Header.Set("Accept-Encoding", "gzip")
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
	res, err := c.HTTP.Do(req)
	if err != nil {
		return rawBytes, wireBytes, err
	}
	defer res.Body.Close()
	respWire, _ := io.ReadAll(io.LimitReader(res.Body, 128<<20))
	respPlain := respWire
	if strings.EqualFold(res.Header.Get("Content-Encoding"), "gzip") ||
		(len(respWire) >= 2 && respWire[0] == 0x1f && respWire[1] == 0x8b) {
		gr, gerr := gzip.NewReader(bytes.NewReader(respWire))
		if gerr != nil {
			return rawBytes, wireBytes, gerr
		}
		plain, gerr := io.ReadAll(io.LimitReader(gr, 128<<20))
		_ = gr.Close()
		if gerr != nil {
			return rawBytes, wireBytes, gerr
		}
		respPlain = plain
	}
	if res.StatusCode >= 400 {
		var e struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(respPlain, &e)
		if e.Error != "" {
			return rawBytes, wireBytes, fmt.Errorf("%s", e.Error)
		}
		return rawBytes, wireBytes, fmt.Errorf("home http %d: %s", res.StatusCode, string(respPlain))
	}
	if out == nil {
		return rawBytes, wireBytes, nil
	}
	return rawBytes, wireBytes, json.Unmarshal(respPlain, out)
}

func (c *Client) Health() error {
	var out map[string]any
	return c.do(http.MethodGet, "/health", nil, &out)
}

func (c *Client) Register(username, password, device string) (*AuthResponse, error) {
	var out AuthResponse
	err := c.do(http.MethodPost, "/v1/auth/register", AuthRequest{Username: username, Password: password, Device: device}, &out)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) Login(username, password, device string) (*AuthResponse, error) {
	var out AuthResponse
	err := c.do(http.MethodPost, "/v1/auth/login", AuthRequest{Username: username, Password: password, Device: device}, &out)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) Logout() error {
	return c.do(http.MethodPost, "/v1/auth/logout", map[string]any{}, nil)
}

func (c *Client) Me() (accountID, username string, err error) {
	var out struct {
		AccountID string `json:"accountId"`
		Username  string `json:"username"`
	}
	if err := c.do(http.MethodGet, "/v1/auth/me", nil, &out); err != nil {
		return "", "", err
	}
	return out.AccountID, out.Username, nil
}

func (c *Client) ListProjects() ([]Project, error) {
	var out struct {
		Projects []Project `json:"projects"`
	}
	if err := c.do(http.MethodGet, "/v1/projects", nil, &out); err != nil {
		return nil, err
	}
	if out.Projects == nil {
		out.Projects = []Project{}
	}
	return out.Projects, nil
}

func (c *Client) GetProject(id string) (*Project, error) {
	var out struct {
		Project Project `json:"project"`
	}
	if err := c.do(http.MethodGet, "/v1/projects/"+url.PathEscape(id), nil, &out); err != nil {
		return nil, err
	}
	return &out.Project, nil
}

func (c *Client) PutProject(p Project) (*Project, error) {
	id := strings.TrimSpace(p.ID)
	path := "/v1/projects"
	if id != "" {
		path = "/v1/projects/" + url.PathEscape(id)
	}
	var out struct {
		Project Project `json:"project"`
	}
	if err := c.do(http.MethodPut, path, p, &out); err != nil {
		return nil, err
	}
	return &out.Project, nil
}

func (c *Client) PutDoc(path, content string, rev int64) (*DocBody, error) {
	var out struct {
		Doc DocBody `json:"doc"`
	}
	if err := c.do(http.MethodPut, "/v1/docs", PutDocRequest{Path: path, Content: content, Rev: rev}, &out); err != nil {
		return nil, err
	}
	return &out.Doc, nil
}

func (c *Client) GetDoc(path string) (*DocBody, error) {
	var out struct {
		Doc DocBody `json:"doc"`
	}
	q := "/v1/docs?path=" + url.QueryEscape(path)
	if err := c.do(http.MethodGet, q, nil, &out); err != nil {
		return nil, err
	}
	return &out.Doc, nil
}

func (c *Client) ListDocs(prefix string) ([]DocMeta, error) {
	q := "/v1/docs"
	if strings.TrimSpace(prefix) != "" {
		q += "?prefix=" + url.QueryEscape(prefix)
	}
	var out struct {
		Docs []DocMeta `json:"docs"`
	}
	if err := c.do(http.MethodGet, q, nil, &out); err != nil {
		return nil, err
	}
	if out.Docs == nil {
		out.Docs = []DocMeta{}
	}
	return out.Docs, nil
}

func (c *Client) GetSync() (*WorkspaceSnapshot, error) {
	return c.getSync("")
}

// GetSyncLite 只拉台账与文档索引，不带正文（探测用）。
func (c *Client) GetSyncLite() (*WorkspaceSnapshot, error) {
	return c.getSync("?lite=1")
}

func (c *Client) getSync(query string) (*WorkspaceSnapshot, error) {
	var out struct {
		Snapshot WorkspaceSnapshot `json:"snapshot"`
	}
	if _, _, err := c.doBytesEx(http.MethodGet, "/v1/sync"+query, nil, false, &out); err != nil {
		return nil, err
	}
	return &out.Snapshot, nil
}

func (c *Client) PutSync(snap WorkspaceSnapshot) (*WorkspaceSnapshot, error) {
	raw, err := json.Marshal(snap)
	if err != nil {
		return nil, err
	}
	saved, _, _, err := c.PutSyncJSON(raw)
	return saved, err
}

// SyncPutResult 上传结果（含压缩体积）。
type SyncPutResult struct {
	Snapshot  *WorkspaceSnapshot
	RawBytes  int64
	GzipBytes int64
}

// PutSyncJSON 上传已序列化的整包（gzip）；便于调用方先算原始大小。
func (c *Client) PutSyncJSON(raw []byte) (*WorkspaceSnapshot, int64, int64, error) {
	var out struct {
		Snapshot  WorkspaceSnapshot `json:"snapshot"`
		GzipBytes int64             `json:"gzipBytes"`
	}
	rawN, wireN, err := c.doBytesEx(http.MethodPut, "/v1/sync", raw, true, &out)
	if err != nil {
		return nil, rawN, wireN, err
	}
	if out.GzipBytes > 0 {
		wireN = out.GzipBytes
	}
	return &out.Snapshot, rawN, wireN, nil
}

// ListMarket 列出技能商店。不需要登录。
func (c *Client) ListMarket() ([]MarketListing, error) {
	var out struct {
		Listings []MarketListing `json:"listings"`
	}
	if err := c.do(http.MethodGet, "/v1/market/listings", nil, &out); err != nil {
		return nil, err
	}
	if out.Listings == nil {
		out.Listings = []MarketListing{}
	}
	return out.Listings, nil
}

// PublishMarket 把一次提交推到技能仓库。需要登录。同一仓库 id 下按提交区分。
func (c *Client) PublishMarket(pkg MarketPackage) (*MarketListing, error) {
	var out struct {
		Listing MarketListing `json:"listing"`
	}
	if err := c.do(http.MethodPut, "/v1/market/listings", pkg, &out); err != nil {
		return nil, err
	}
	return &out.Listing, nil
}

// GetMarketPackage 下载商店里的一个版本。
func (c *Client) GetMarketPackage(id, version string) (*MarketPackage, error) {
	q := "/v1/market/package?id=" + url.QueryEscape(id) + "&version=" + url.QueryEscape(version)
	var out struct {
		Package MarketPackage `json:"package"`
	}
	if err := c.do(http.MethodGet, q, nil, &out); err != nil {
		return nil, err
	}
	return &out.Package, nil
}

// ParseSizeHeader 读响应头里的体积提示。
func ParseSizeHeader(h http.Header, key string) int64 {
	n, _ := strconv.ParseInt(strings.TrimSpace(h.Get(key)), 10, 64)
	return n
}
