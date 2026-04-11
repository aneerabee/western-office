export const statusMeta = {
  new: { label: 'جديدة', color: '#64748b' },
  sent_to_operator: { label: 'مرسلة للموظف', color: '#2563eb' },
  under_review: { label: 'قيد المراجعة', color: '#8b5cf6' },
  issue: { label: 'فيها مشكلة', color: '#dc2626' },
  approved: { label: 'مقبولة', color: '#0f766e' },
  customer_confirmed: { label: 'مؤكدة للزبون', color: '#15803d' },
  sent_to_accountant: { label: 'مرسلة للمحاسب', color: '#b45309' },
  paid: { label: 'مدفوعة', color: '#166534' },
  closed: { label: 'مغلقة', color: '#1f2937' },
}

export const seedTransfers = [
  {
    id: 1,
    reference: 'WU-843210',
    senderName: 'مجدي الشريف',
    receiverName: 'محمد الورفلي',
    status: 'customer_confirmed',
    issueCode: '',
    systemAmount: 1900,
    customerAmount: 1885,
    margin: 15,
    paymentStatus: 'pending',
    note: 'تم تأكيدها للزبون وبانتظار طلب التنفيذ من المحاسب.',
    createdAt: '2026-04-11T09:10:00.000Z',
  },
  {
    id: 2,
    reference: 'WU-843211',
    senderName: 'سارة المبروك',
    receiverName: 'ليلى الفيتوري',
    status: 'issue',
    issueCode: 'name_mismatch',
    systemAmount: null,
    customerAmount: null,
    margin: null,
    paymentStatus: 'pending',
    note: 'الموظف أشار إلى مشكلة تطابق في الاسم.',
    createdAt: '2026-04-11T10:20:00.000Z',
  },
  {
    id: 3,
    reference: 'WU-843212',
    senderName: 'محمود القماطي',
    receiverName: 'خالد الجالي',
    status: 'paid',
    issueCode: '',
    systemAmount: 2350,
    customerAmount: 2328,
    margin: 22,
    paymentStatus: 'paid',
    note: 'أُقفلت بعد تنفيذ المحاسب للدفع.',
    createdAt: '2026-04-11T11:15:00.000Z',
  },
]

export const issueCatalog = [
  {
    code: 'name_mismatch',
    label: 'الاسم غير مطابق',
    description: 'اسم المستفيد أو المرسل لا يطابق ما يظهر في الوصل أو السيستم.',
  },
  {
    code: 'already_picked',
    label: 'الحوالة مسحوبة مسبقًا',
    description: 'الموظف يجد أن الحوالة أُنجزت سابقًا ولا يمكن اعتمادها مرة ثانية.',
  },
  {
    code: 'missing_info',
    label: 'نقص بيانات',
    description: 'رقم الحوالة أو الاسم غير واضحين ويحتاجان مراجعة قبل المتابعة.',
  },
  {
    code: 'system_hold',
    label: 'معلقة على السيستم',
    description: 'السيستم لم يحسم الحالة بعد أو يحتاج انتظارًا إضافيًا.',
  },
]

export const operationalRules = [
  {
    title: '1. إدخال خفيف',
    description: 'أضف فقط اسم المرسل واسم المستلم ورقم الحوالة، ثم ارجع للعمل مباشرة.',
  },
  {
    title: '2. تغيير الحالة من الجدول',
    description: 'بعد رد الموظف غيّر الحالة مباشرة من نفس السطر بدون فتح نموذج جديد.',
  },
  {
    title: '3. القيم عند الحاجة فقط',
    description: 'قيمة السيستم وقيمة الزبون لا تُكتب إلا عندما تحتاجهما للحساب أو الدفع.',
  },
  {
    title: '4. قائمة محاسب واضحة',
    description: 'عندما تؤكد الحوالة للزبون أو ترسلها للمحاسب تظهر في قائمة منفصلة.',
  },
  {
    title: '5. إغلاق يومي سريع',
    description: 'الملخص العلوي يعطيك عدد الحوالات والمشاكل والمدفوعات بدون حساب يدوي.',
  },
  {
    title: '6. أنت فقط المستخدم',
    description: 'التصميم موجه لصاحب المكتب نفسه، لذلك الواجهة مباشرة ولا تحتوي صلاحيات معقدة.',
  },
]
