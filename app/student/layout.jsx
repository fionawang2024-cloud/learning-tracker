import StudentSubNav from "@/components/student/StudentSubNav";

export default function StudentLayout({ children }) {
  return (
    <div className="student-layout">
      <StudentSubNav />
      {children}
    </div>
  );
}
