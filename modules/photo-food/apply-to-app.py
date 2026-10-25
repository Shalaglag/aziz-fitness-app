"""Inline the PhotoFood card into the app's single HTML file.
Usage: python3 apply-to-app.py <app.html> [out.html]   (writes in place when out is omitted)
Idempotent: refuses to patch a file that already contains PhotoFood."""
import pathlib, sys

src = pathlib.Path(sys.argv[1]); out = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else sys.argv[1])
html = src.read_text(encoding="utf-8")
if "const PhotoFood" in html:
    sys.exit("already patched")
mod = (pathlib.Path(__file__).parent / "photo-food.js").read_text(encoding="utf-8")

def swap(old, new):
    global html
    assert html.count(old) == 1, "anchor not found once: " + old[:60]
    html = html.replace(old, new)

# 1. the module, as its own script just before the app's main script
main = html.rindex("<script>")
html = html[:main] + "<script>\n" + mod + "</script>\n" + html[main:]
# 2. the card on the Food tab, under the manual add form and above "Pick my meals"
swap("  ${pickerCard(d, training)}", "  ${typeof PhotoFood !== \"undefined\" ? PhotoFood.html(d, day) : \"\"}\n  ${pickerCard(d, training)}")
# 3. css + events, once at boot
swap("initStore();\n</script>", """try{
  const st=document.createElement("style"); st.textContent=PhotoFood.css; document.head.appendChild(st);
  PhotoFood.bind(document, {
    getSample: () => window.claude && window.claude.use ? window.claude.use("sample").catch(()=>null) : Promise.resolve(null),
    getDay, date: () => view.date, render,
    onAdd(date, items){ const day=getDay(date); day.food=day.food.concat(items); saveDay(day); toast(items.length===1 ? "Added as an estimate" : "Added "+items.length+" items as estimates"); }
  });
}catch(e){}
initStore();
</script>""")
out.write_text(html, encoding="utf-8")
print("patched", out)
