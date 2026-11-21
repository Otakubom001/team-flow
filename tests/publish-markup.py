"""Catch missing publishing controls, including malformed select option markup."""
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
import re

root = Path(__file__).resolve().parent.parent

class Controls(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = []
        self.custom_option = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if 'id' in attrs:
            self.ids.append(attrs['id'])
        if attrs.get('id') == 'pub-custom-option':
            self.custom_option = (tag, attrs.get('value'))

parser = Controls()
parser.feed((root / 'index.html').read_text(encoding='utf-8'))
assert parser.custom_option == ('option', 'custom')
assert not [key for key, count in Counter(parser.ids).items() if count > 1]
for script in ('publish.js', 'buffer-client.js'):
    refs = set(re.findall(r"\$\('([^']+)'\)", (root / script).read_text(encoding='utf-8')))
    assert not refs - set(parser.ids), refs - set(parser.ids)
print('PASS: publishing HTML controls and custom scheduling option')
