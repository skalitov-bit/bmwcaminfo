#!/usr/bin/env python3
"""Compatibility entry point: replace the camera database from the current Updater ZIP."""
from import_mapcam import convert, ROOT
if __name__ == '__main__':
    convert(ROOT.parent / 'BMW MapCam.zip')
