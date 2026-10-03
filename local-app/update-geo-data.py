"""Refresh public, country-only IP ranges. Never sends visitor IPs anywhere."""
import csv, gzip, hashlib, io, ipaddress, json, urllib.request
from pathlib import Path
from datetime import datetime, timezone

root = Path(__file__).resolve().parent / 'geo-data'
root.mkdir(exist_ok=True)
metadata = {'source': 'https://github.com/sapics/ip-location-db', 'license': 'PDDL 1.0', 'downloaded': datetime.now(timezone.utc).isoformat(), 'files': {}}
for version in (4, 6):
    name = f'user-country-ipv{version}.csv'
    url = f'https://github.com/sapics/ip-location-db/releases/download/latest/{name}'
    source = urllib.request.urlopen(url, timeout=60).read()
    width = 4 if version == 4 else 16
    data = bytearray()
    previous = -1
    for start, end, country in csv.reader(io.StringIO(source.decode('utf-8'))):
        low, high = int(ipaddress.ip_address(start)), int(ipaddress.ip_address(end))
        if low <= previous or low > high or len(country) != 2 or not country.isascii() or not country.isupper():
            raise ValueError('Invalid or unsorted country database')
        data.extend(low.to_bytes(width, 'big') + high.to_bytes(width, 'big') + country.encode('ascii'))
        previous = high
    packed = gzip.compress(data, compresslevel=9, mtime=0)
    (root / f'country-v{version}.bin.gz').write_bytes(packed)
    metadata['files'][name] = {'url': url, 'source_sha256': hashlib.sha256(source).hexdigest(), 'records': len(data) // (width * 2 + 2), 'packed_bytes': len(packed)}
    print(name, metadata['files'][name]['records'], 'ranges;', len(packed), 'bytes')
(root / 'source.json').write_text(json.dumps(metadata, indent=2), encoding='utf-8')
