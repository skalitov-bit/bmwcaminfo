"""Reject a Linux executable with a loader absent on MGU, before packaging."""
import struct

def verify_mgu_elf(data):
    if data[:6] != b'\x7fELF\x02\x01' or len(data) < 64:
        raise ValueError('Expected little-endian ELF64')
    if struct.unpack_from('<H', data, 18)[0] != 62:
        raise ValueError('Expected MGU x86_64 executable')
    start = struct.unpack_from('<Q', data, 32)[0]
    stride, count = struct.unpack_from('<HH', data, 54)
    if stride < 56 or start + stride * count > len(data):
        raise ValueError('Invalid ELF program headers')
    loaders = []
    for index in range(count):
        at = start + stride * index
        if struct.unpack_from('<I', data, at)[0] != 3:
            continue
        offset = struct.unpack_from('<Q', data, at + 8)[0]
        length = struct.unpack_from('<Q', data, at + 32)[0]
        if offset + length > len(data):
            raise ValueError('Invalid ELF interpreter segment')
        loaders.append(data[offset:offset + length])
    if loaders != [b'/lib/ld-linux-x86-64.so.2\x00']:
        raise ValueError('MGU requires /lib/ld-linux-x86-64.so.2; found ' + repr(loaders))
    return {'architecture': 'x86_64', 'interpreter': '/lib/ld-linux-x86-64.so.2'}
