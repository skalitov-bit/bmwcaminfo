import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('import_mapcam',Path(__file__).parents[1]/'tools/import_mapcam.py')
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class ImportTests(unittest.TestCase):
    def row(self, **changes):
        r=dict(id=123,latitude=56.6,longitude=47.9,speed_limit_kmh=None,direction_type=1,
               approach_heading_deg=350,type_code=1,type_key='fixed_speed',warning_distance_m=500)
        r.update(changes)
        return r

    def test_unknown_limit_and_direction(self):
        c=m.camera(self.row(),'2026-11-11T14:25:39Z')
        self.assertIsNone(c['limit'])
        self.assertEqual(c['mapcamTravel'],[350])
        self.assertIn('2026-11-11',c['sourceLabel'])

    def test_both_directions_wrap(self):
        self.assertEqual(m.camera(self.row(direction_type=2),'2026-11-11')['mapcamTravel'],[350,170])

    def test_omnidirectional_does_not_invent_heading(self):
        self.assertEqual(m.camera(self.row(direction_type=0),'2026-11-11')['mapcamTravel'],[])

    def test_invalid_coordinates_rejected(self):
        for fields in [dict(latitude=float('nan')),dict(longitude=181),dict(direction_type=9),dict(speed_limit_kmh=999)]:
            with self.assertRaises(ValueError):m.camera(self.row(**fields),'2026-11-11')

    def test_polygon_holes_and_islands(self):
        outer=[[0,0],[10,0],[10,10],[0,10],[0,0]]
        hole=[[3,3],[7,3],[7,7],[3,7],[3,3]]
        island=[[20,20],[21,20],[21,21],[20,21],[20,20]]
        g=dict(type='MultiPolygon',coordinates=[[outer,hole],[island]])
        self.assertTrue(m.inside(1,1,g));self.assertFalse(m.inside(5,5,g))
        self.assertTrue(m.inside(20.5,20.5,g));self.assertFalse(m.inside(-1,1,g))

    def test_native_delta_order_latitude_then_longitude(self):
        # Known standard delta vector, anchored at the record rather than at zero.
        self.assertEqual(m.decode_geometry('_p~iF~ps|U_ulLnnqC_mqNvxq`@',0,0),
                         [[0,0],[38.5,-120.2],[40.7,-120.95],[43.252,-126.453]])
        self.assertEqual(m.decode_geometry('gEoK',56,48),[[56,48],[56.001,48.002]])

    def test_malformed_geometry_rejected(self):
        for encoded in ['_', 'gE', '\x00?', '~'*10]:
            with self.assertRaises(ValueError):m.decode_geometry(encoded,56,48)

    def test_sector_and_unknown_optional_fields_preserved(self):
        c=m.camera(self.row(angle_code_raw=24,encoded_geometry='gEoK'),'2026-11-11')
        self.assertEqual(c['mapcamAngleDeg'],24)
        self.assertEqual(len(c['mapcamPath']),2)
        self.assertIsNone(c['mapcamHours'])
        self.assertIsNone(c['mapcamControlDirection'])
        c=m.camera(self.row(control_direction=2,hour_start=22,hour_end=6),'2026-11-11')
        self.assertEqual(c['mapcamHours'],[22,6])
        self.assertEqual(c['mapcamControlDirection'],2)

if __name__=='__main__':unittest.main()
