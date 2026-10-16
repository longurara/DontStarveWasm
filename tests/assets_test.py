import io
from pathlib import Path
import sys
import unittest
import zipfile

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
from assets import build,animation,texture

class AssetTests(unittest.TestCase):
    def test_original_wilson_mesh_and_texture(self):
        with zipfile.ZipFile(ROOT.parent/'data/anim/wilson.zip') as z:
            value=build(z.read('build.bin'))
            self.assertEqual(value['name'],'wilson')
            self.assertEqual(len(value['symbols']),15)
            self.assertEqual(len(value['vertices']),3192)
            width,height,pixels=texture(z.read(value['atlases'][0]))
            self.assertEqual(len(pixels),width*height*4)
            self.assertTrue(any(pixels[i]<255 for i in range(3,len(pixels),4)))
    def test_original_animation_counts(self):
        with zipfile.ZipFile(ROOT.parent/'data/anim/player_basic.zip') as z:
            value=animation(z.read('anim.bin'))
            runs=[a for a in value['animations'] if a['name']=='run_loop']
            self.assertEqual(len(runs),3)
            self.assertTrue(all(len(a['frames'])==16 for a in runs))
    def test_bad_headers_and_truncated_assets_fail(self):
        for reader in [build,animation,texture]:
            for invalid in [b'',b'NOPE'+bytes(60)]:
                with self.assertRaises(ValueError):reader(invalid)
        with zipfile.ZipFile(ROOT.parent/'data/anim/wilson.zip') as z:
            with self.assertRaises(ValueError):build(z.read('build.bin')[:-10])

if __name__=='__main__':unittest.main()
