"""Add a separate transient RHMI popUp; never map it as the app entry screen.

Container/widget/property vocabulary: idrive7-apps/docs/rhmi-widgets.md.
The combination with an image and openState remains vehicle-unverified.
"""
def add_notification_layout(xml, ui):
    if '9000' in ui['containers']:
        raise ValueError('Popup container id collision')
    popup = '''    <container id="9000" type="popUp" widget="LT_State_Wide">
        <property id="13" value="3500"/>
        <layoutGroup id="9002" name="List">
            <component id="9001" type="label" widget="LT_Label_1Graphic_Scalable">
                <property id="2" value="1"/>
                <property id="3" value="0"/>
            </component>
        </layoutGroup>
    </container>
'''
    ui['containers']['9000'] = {
        'type': 'popUp', 'name': 'SPEEDCAM_POPUP',
        'properties': {'Timeout': {'value': 3500, 'type': 'UInt'}},
        'components': {'9001': {
            'type': 'label', 'name': 'SPEEDCAM_POPUP_GFX',
            'properties': {'Visible': {'value': 1, 'type': 'UInt'},
                           'Focusable': {'value': 0, 'type': 'UInt'}},
            'rows': [{'Graphic': {'value': '', 'type': 'Text'}}]
        }}
    }
    return xml.replace('</application>', popup + '</application>')
