#!/usr/bin/env python3
"""Create an offline clip gallery and a slide-ready archive; verify MP4 metadata."""
from pathlib import Path
import hashlib
import html
import json
import subprocess
import zipfile

HERE = Path(__file__).resolve().parent
MEDIA = HERE / "recordings"
data = json.loads((HERE.parent / "web/public/presentation/examples.json").read_text())
manifest = json.loads((MEDIA / "manifest.json").read_text())
assert manifest["paper_sha256"] == data["paper_sha256"]
assert {clip["id"] for clip in manifest["clips"]} == {example["id"] for example in data["examples"]}
cards = []
for clip in manifest["clips"]:
    video = MEDIA / clip["file"]
    assert hashlib.sha256(video.read_bytes()).hexdigest() == clip["sha256"]
    info = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(video)]))
    stream = info["streams"][0]
    assert stream["codec_name"] == "h264" and stream["pix_fmt"] == "yuv420p"
    assert (stream["width"], stream["height"]) == (1920, 1080)
    assert abs(float(info["format"]["duration"]) - clip["seconds"]) < 0.2
    name = ("Bonus" if clip["id"] == "lower-bound" else f"Lemma {int(clip['id'].split('-')[1])}")
    cards.append(f'''<article><h2>{name} · {html.escape(clip['title'])}</h2>
<video controls preload="none" playsinline poster="{clip['id']}.jpg" src="{clip['file']}"></video>
<p>{clip['seconds']} seconds · <a href="{clip['file']}" download>Download MP4</a> · <a href="{clip['caption_file']}" download>Captions</a></p></article>''')
page = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Counting · STOC presentation clips</title><style>
*{box-sizing:border-box}body{margin:0;background:#faf8f2;color:#1c2d43;font-family:system-ui,sans-serif}main{max-width:1400px;margin:auto;padding:42px 30px}h1{font-size:42px;letter-spacing:-.04em;margin:0 0 12px}header p{font-size:17px;line-height:1.5;max-width:850px;color:#536679}section{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,480px),1fr));gap:32px;margin-top:36px}h2{font-size:20px;font-weight:600}video{display:block;width:100%;aspect-ratio:16/9;background:#eee;box-shadow:0 2px 14px #21384c13}article p{font-size:14px}a{color:#245c96}footer{margin-top:40px;font-size:13px;color:#5c7082}
</style><main><header><h1>Counting: visual lemma examples</h1><p>Sixteen lemmas and one lower-bound comparison. Short, silent clips with English captions, ready to insert into slides. The examples illustrate proof mechanisms; they do not replace the general proofs.</p><p>MP4 · H.264 · 1920 × 1080 · 30 fps. In PowerPoint or Keynote, insert each MP4 as a video. Captions are already visible in the recording.</p></header><section>''' + "\n".join(cards) + "</section><footer>Source paper SHA-256: " + data["paper_sha256"] + "</footer></main></html>\n"
(MEDIA / "index.html").write_text(page)
(MEDIA / "README.txt").write_text("Open index.html to preview every clip. Insert the MP4 files directly into PowerPoint or Keynote. These videos are silent, with English annotations burned into the image. SRT files allow you to reuse or edit the text. Refer to STORYBOARD.md for the general proof connection and scope of each example.\n")
with zipfile.ZipFile(HERE / "STOC-clips.zip", "w", zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(MEDIA.iterdir()):
        if path.is_file():
            archive.write(path, path.name)
    archive.write(HERE / "STORYBOARD.md", "STORYBOARD.md")
print(f"Verified and packaged {len(manifest['clips'])} Full HD clips: {HERE / 'STOC-clips.zip'}")
