package openai

import (
	"bytes"
	"testing"
)

func TestRewriteUpstreamImageURLsHidesGo2api(t *testing.T) {
	in := []byte(`{"created":1792638149,"data":[{"url":"http://tu.go2api.cc/v1/images/evt-x/content?exp=1&sig=a"}]}`)
	out := rewriteUpstreamImageURLs(in, "https://api.synai996.space/go2img")
	want := `"url":"https://api.synai996.space/go2img/v1/images/evt-x/content?exp=1&sig=a"`
	if !bytes.Contains(out, []byte(want)) {
		t.Fatalf("proxy rewrite missing: %s", out)
	}
	if bytes.Contains(out, []byte("tu.go2api.cc")) {
		t.Fatalf("upstream host still visible: %s", out)
	}

	httpsIn := []byte(`{"data":[{"url":"https://tu.go2api.cc/v1/images/evt-x/content"}]}`)
	httpsOut := rewriteUpstreamImageURLs(httpsIn, "https://api.synai996.space/go2img")
	if bytes.Contains(httpsOut, []byte("tu.go2api.cc")) {
		t.Fatalf("https upstream host still visible: %s", httpsOut)
	}

	other := []byte(`{"data":[{"url":"https://cdn.example/a.png"}]}`)
	if !bytes.Equal(rewriteUpstreamImageURLs(other, "https://api.synai996.space/go2img"), other) {
		t.Fatal("unrelated https url should stay unchanged")
	}

	noteIn := []byte(`{"data":[{"url":"https://note1.17zz.xyz/images/node208/a.png?exp=1&sig=s"}]}`)
	noteOut := rewriteUpstreamImageURLs(noteIn, "https://api.synai996.space/go2img")
	wantNote := `"url":"https://api.synai996.space/go2img/h/note1.17zz.xyz/images/node208/a.png?exp=1&sig=s"`
	if !bytes.Contains(noteOut, []byte(wantNote)) {
		t.Fatalf("17zz proxy rewrite missing: %s", noteOut)
	}
	if bytes.Contains(noteOut, []byte("https://note1.17zz.xyz")) || bytes.Contains(noteOut, []byte("http://note1.17zz.xyz")) {
		t.Fatalf("17zz origin still visible: %s", noteOut)
	}

	escIn := []byte(`{"data":[{"url":"https://note0.17zz.xyz/images/node0/a.png?exp=1\u0026sig=s"}]}`)
	escOut := rewriteUpstreamImageURLs(escIn, "https://api.synai996.space/go2img")
	wantEsc := `"url":"https://api.synai996.space/go2img/h/note0.17zz.xyz/images/node0/a.png?exp=1&sig=s"`
	if !bytes.Contains(escOut, []byte(wantEsc)) {
		t.Fatalf("escaped ampersand rewrite missing: %s", escOut)
	}
	if bytes.Contains(escOut, []byte(`\u0026`)) {
		t.Fatalf("\\u0026 still present: %s", escOut)
	}

	cfIn := []byte(`{"data":[{"url":"https://dnznrvs05pmza.cloudfront.net/gemini/x.png?_jwt=a"}]}`)
	cfOut := rewriteUpstreamImageURLs(cfIn, "https://api.synai996.space/go2img")
	wantCF := `"url":"https://api.synai996.space/go2img/h/dnznrvs05pmza.cloudfront.net/gemini/x.png?_jwt=a"`
	if !bytes.Contains(cfOut, []byte(wantCF)) {
		t.Fatalf("cloudfront proxy rewrite missing: %s", cfOut)
	}
}

func TestRewriteUpstreamImageURLsHttpsFallback(t *testing.T) {
	in := []byte(`{"data":[{"url":"http://cdn.example/a.png"}]}`)
	out := rewriteUpstreamImageURLs(in, "")
	if !bytes.Contains(out, []byte(`"url":"https://cdn.example/a.png"`)) {
		t.Fatalf("http upgrade missing: %s", out)
	}
}
