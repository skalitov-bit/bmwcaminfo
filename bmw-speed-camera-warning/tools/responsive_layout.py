"""Opt-in wide RHMI page and one geometry policy for SpeedCAM's two render paths."""
import xml.etree.ElementTree as ET

def patch_layout(xml,ui,app):
    if not app.get('responsiveMain'):return xml
    tree=ET.fromstring(xml)
    ids=[key for key,c in ui['containers'].items() if c.get('name')=='MAIN']
    if len(ids)!=1:raise ValueError('Expected exactly one MAIN state')
    main=tree.find("container[@id='%s']" % ids[0])
    if main is None or main.get('widget')!='LT_State_Laptimer':raise ValueError('Unexpected MAIN template')
    # The regular wide page has no Laptimer-owned lower toolbar background.
    # Keep the graphic, title and IDs so the existing RHMI/event bindings survive.
    main.set('widget','LT_State_Wide')
    for bar in main.findall("layoutGroup[@name='Bar']"):main.remove(bar)
    return '<?xml version="1.0" encoding="UTF-8"?>\n'+ET.tostring(tree,encoding='unicode')

def patch_display(raw):
    s=raw.decode('utf8')
    old='        softImage = underBar(softImage);'
    if s.count(old)!=1:raise ValueError('Unexpected fallback wrapper')
    s=s.replace(old,"""        if (require('./responsive-display').enabled(this)) {
            const output=softImage;
            const frames=this.speedcamSoftwareFrames||(this.speedcamSoftwareFrames=new (require('./responsive-display').SoftwareFrames)());
            softImage=(id,cv)=>frames.image(cv,this.gpu&&this.gpu.screen,out=>output(id,out));
        } else softImage = underBar(softImage);""")
    old="""        const cv = new Canvas(r.w, r.h);
        play(r.words(), cv);
        return softImage(name, cv);"""
    if s.count(old)!=1:raise ValueError('Unexpected software frame path')
    s=s.replace(old,"""        const cv = this.speedcamSoftwareFrames ? this.speedcamSoftwareFrames.canvas(r.w,r.h) : new Canvas(r.w,r.h);
        play(r.words(), cv);
        return softImage(name, cv);""")
    return (s+"\nrequire('./responsive-display').install(Display);\n").encode('utf8')
