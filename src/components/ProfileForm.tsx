import { useState } from 'react';
import { Plus, Upload, UserRound, X } from 'lucide-react';
import type { ResumeDocument, ResumeProfile, ResumeProfileExtraField } from '../model';
import './profile.css';

type Props = { document: ResumeDocument; onUpdate: (fn: (document: ResumeDocument) => ResumeDocument) => void; photoUrl?: string; photoBusy: boolean; onChoosePhoto: () => void };

const COMMON_FIELDS = [
  { key: 'highestDegree', label: '学历', aliases: ['degree', 'education', '最高学历'], group: 'basic' },
  { key: 'age', label: '年龄', aliases: [], group: 'basic' },
  { key: 'gender', label: '性别', aliases: ['sex'], group: 'basic' },
  { key: 'expectedSalary', label: '期望薪资', aliases: ['salary', '薪资', '薪酬', '期望薪酬'], group: 'job' },
] as const;
type CommonField = typeof COMMON_FIELDS[number];
function matchesCommon(extra: ResumeProfileExtraField, common: CommonField) {
  const names: readonly string[] = [common.key, common.label, ...common.aliases];
  return names.some(name => name.toLowerCase() === extra.key.toLowerCase() || name === extra.label);
}
function extraGroup(extra: ResumeProfileExtraField) {
  return COMMON_FIELDS.find(common => matchesCommon(extra, common))?.group ?? 'other';
}
const cleanInput = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, '');

export default function ProfileForm({ document, onUpdate, photoUrl, photoBusy, onChoosePhoto }: Props) {
  const [customLabel, setCustomLabel] = useState('');
  const extras = document.profile.extraFields ?? [];
  const atLimit = extras.length >= 30;
  function addField(key: string, label: string) {
    onUpdate(current => {
      const fields = current.profile.extraFields ?? [];
      if (fields.length >= 30 || fields.some(extra => extra.key === key)) return current;
      return { ...current, profile: { ...current.profile, extraFields: [...fields, { key, label, value: '' }] } };
    });
  }
  function extraField(extra: ResumeProfileExtraField) {
    return <div className="field profile-extra-field" key={extra.key}>
      <span className="profile-extra-heading"><span>{extra.label}</span><button type="button" className="profile-remove-field" aria-label={`移除${extra.label}信息`} title={`移除${extra.label}`} onClick={() => onUpdate(current => ({ ...current, profile: { ...current.profile, extraFields: current.profile.extraFields?.filter(field => field.key !== extra.key) } }))}><X size={13}/></button></span>
      <input aria-label={extra.label} autoComplete="off" maxLength={2000} inputMode={extra.key === 'age' ? 'numeric' : undefined} value={extra.value} onChange={event => { const value = cleanInput(event.target.value); onUpdate(current => ({ ...current, profile: { ...current.profile, extraFields: current.profile.extraFields?.map(field => field.key === extra.key ? { ...field, value } : field) } })); }}/>
    </div>;
  }
  function addCustomField() {
    const label = cleanInput(customLabel).trim();
    if (!label || atLimit) return;
    addField(`custom-${crypto.randomUUID()}`, label);
    setCustomLabel('');
  }
  function field(key: keyof Omit<ResumeProfile, 'photoId' | 'extraFields'>, label: string, placeholder = '') {
    return <label className="field" key={key}><span>{label}</span><input aria-label={label} autoComplete="off" inputMode={key === 'phone' ? 'tel' : key === 'email' ? 'email' : undefined} value={document.profile[key]} placeholder={placeholder} onChange={event => onUpdate(current => ({ ...current, profile: { ...current.profile, [key]: event.target.value } }))}/></label>;
  }
  return <div className="reference-profile-form">
    <div className="profile-three-fields">{field('name', '姓名')}{field('phone', '电话')}{field('email', '邮箱')}{extras.filter(extra => extraGroup(extra) === 'basic').map(extraField)}</div>
    <div className="reference-photo-field"><span>头像</span><div className="reference-photo-row"><button className="reference-photo" aria-label="选择简历照片" onClick={onChoosePhoto} disabled={photoBusy}>{photoUrl ? <img src={photoUrl} alt="简历头像"/> : <UserRound size={36}/>}</button><div><button className="button secondary" onClick={onChoosePhoto} disabled={photoBusy}><Upload size={14}/>{photoBusy ? '处理中' : '上传'}</button>{photoUrl && <button className="text-button" onClick={() => onUpdate(current => ({ ...current, profile: { ...current.profile, photoId: undefined } }))}><X size={12}/>移除头像</button>}</div></div></div>
    <div className="profile-three-fields">{field('github', 'GitHub', '请输入 GitHub 主页')}</div>
    <h3>求职意向</h3><div className="profile-three-fields">{field('status', '当前状态', '例如：应届毕业生')}{field('title', '职位名称', '请输入职位名称')}{field('city', '期望工作地')}{extras.filter(extra => extraGroup(extra) === 'job').map(extraField)}</div>
    <h3>其他信息</h3><div className="profile-three-fields">{field('website', '个人网站', '请输入个人网站地址')}{extras.filter(extra => extraGroup(extra) === 'other').map(extraField)}</div>
    <details className="profile-add-fields"><summary><Plus size={14}/>添加信息</summary><div className="profile-common-fields">{COMMON_FIELDS.filter(common => !extras.some(extra => matchesCommon(extra, common))).map(common => <button type="button" key={common.key} disabled={atLimit} onClick={() => addField(common.key, common.label)}><Plus size={12}/>{common.label}</button>)}</div><div className="profile-custom-field"><input aria-label="新信息名称" maxLength={200} value={customLabel} disabled={atLimit} placeholder="自定义名称" onChange={event => setCustomLabel(cleanInput(event.target.value))} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addCustomField(); } }}/><button type="button" disabled={atLimit || !customLabel.trim()} onClick={addCustomField}>添加</button></div>{atLimit && <small role="status">最多添加 30 项信息</small>}</details>
  </div>;
}
