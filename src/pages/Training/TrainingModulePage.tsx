// src/pages/Training/TrainingModulePage.tsx
import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  CheckCircle,
  XCircle,
  ChevronRight,
  ChevronLeft,
  RotateCcw,
  Trophy,
  AlertCircle,
  MapPin,
} from 'lucide-react';
import { contractorService, TrainingAttempt } from '../../lib/contractorService';
import {
  getModuleById,
  QUIZ_PASS_THRESHOLD,
  LessonSection,
  TextSection,
  ImageSection,
  StoryboardSection,
  VideoSection,
} from '../../lib/training/index';
import { trainingService } from '../../lib/trainingService';
import { TRAINING_WORKER } from '../../lib/trainingData';
import { setStorageItem } from '../../lib/localStorage';

type PageView = 'lesson' | 'quiz' | 'results';

// =============================================================================
// SECTION RENDERERS
// =============================================================================

/** Renders a plain text section with optional heading */
const TextSectionRenderer: React.FC<{ section: TextSection }> = ({ section }) => {
  const navigate = useNavigate();
  const paragraphs = section.body.split('\n\n').filter((p) => p.trim().length > 0);

  return (
    <div className="mb-8">
      {section.heading && (
        <h3 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
          <div className="w-1 h-6 bg-blue-500 rounded-full flex-shrink-0" />
          {section.heading}
        </h3>
      )}
      <div className="space-y-4">
        {paragraphs.map((para, i) => {
          // Check if paragraph starts with a number + period (numbered list)
          const isNumberedItem = /^\d+\.\s/.test(para.trim());
          if (isNumberedItem) {
            return (
              <p
                key={i}
                className="text-gray-300 leading-relaxed text-sm pl-4 border-l-2 border-gray-800"
              >
                {para}
              </p>
            );
          }

          return (
            <p key={i} className="text-gray-300 leading-relaxed text-sm">
              {para}
            </p>
          );
        })}
      </div>
      {section.linkTo && (
        <button
          onClick={() => {
            // If linking to logsheet, enable training mode first (same flow as HomePage training login)
            if (section.linkTo === '/logsheet') {
              trainingService.enableTrainingMode();
              setStorageItem('current_user', TRAINING_WORKER);
              // Store return path so logsheet header can link back to this lesson
              sessionStorage.setItem('training_return_path', window.location.pathname);
            }
            navigate(section.linkTo!);
          }}
          className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          {section.linkLabel || 'Open'}
          <ChevronRight size={16} />
        </button>
      )}
    </div>
  );
};

/** Renders a text section with an accompanying image */
const ImageSectionRenderer: React.FC<{ section: ImageSection }> = ({ section }) => {
  const paragraphs = section.body.split('\n\n').filter((p) => p.trim().length > 0);
  const pos = section.image.position || 'top';
  const maxH = section.image.maxHeight || 200;

  // Top position: image above text
  if (pos === 'top') {
    return (
      <div className="mb-8">
        {section.heading && (
          <h3 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
            <div className="w-1 h-6 bg-blue-500 rounded-full flex-shrink-0" />
            {section.heading}
          </h3>
        )}
        <div className="mb-4 rounded-xl overflow-hidden bg-gray-800/50 flex items-center justify-center p-4">
          <img
            src={section.image.src}
            alt={section.image.alt}
            style={{ maxHeight: `${maxH}px` }}
            className="object-contain rounded-lg"
            loading="lazy"
          />
        </div>
        <div className="space-y-4">
          {paragraphs.map((para, i) => (
            <p key={i} className="text-gray-300 leading-relaxed text-sm">
              {para}
            </p>
          ))}
        </div>
      </div>
    );
  }

  // Inline right/left: image floated beside text
  const isRight = pos === 'inline-right';

  return (
    <div className="mb-8">
      {section.heading && (
        <h3 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
          <div className="w-1 h-6 bg-blue-500 rounded-full flex-shrink-0" />
          {section.heading}
        </h3>
      )}
      <div className="sm:flex sm:gap-5">
        {/* Image */}
        <div
          className={`flex-shrink-0 mb-4 sm:mb-0 ${
            isRight ? 'sm:order-2' : 'sm:order-1'
          }`}
          style={{ maxWidth: '180px' }}
        >
          <div className="rounded-xl overflow-hidden bg-gray-800/50 p-3 flex items-center justify-center">
            <img
              src={section.image.src}
              alt={section.image.alt}
              style={{ maxHeight: `${maxH}px` }}
              className="object-contain"
              loading="lazy"
            />
          </div>
        </div>
        {/* Text */}
        <div className={`flex-1 space-y-4 ${isRight ? 'sm:order-1' : 'sm:order-2'}`}>
          {paragraphs.map((para, i) => (
            <p key={i} className="text-gray-300 leading-relaxed text-sm">
              {para}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
};

/** Interactive storyboard with clickable Next/Previous steps */
const StoryboardRenderer: React.FC<{ section: StoryboardSection }> = ({ section }) => {
  const [currentFrame, setCurrentFrame] = useState(0);
  const frame = section.frames[currentFrame];
  const totalFrames = section.frames.length;

  const goNext = () => setCurrentFrame((prev) => Math.min(prev + 1, totalFrames - 1));
  const goPrev = () => setCurrentFrame((prev) => Math.max(prev - 1, 0));

  return (
    <div className="mb-8">
      {/* Heading */}
      <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
        <div className="w-1 h-6 bg-purple-500 rounded-full flex-shrink-0" />
        {section.heading}
      </h3>
      {section.description && (
        <p className="text-gray-400 text-sm mb-4">{section.description}</p>
      )}

      {/* Map container */}
      <div className="bg-gray-900 rounded-xl border border-gray-700 overflow-hidden">
        {/* Step label bar */}
        <div className="bg-gray-800 px-4 py-2.5 flex items-center justify-between border-b border-gray-700">
          <div className="flex items-center gap-2">
            <MapPin size={14} className="text-purple-400" />
            <span className="text-white text-sm font-bold">{frame.label}</span>
          </div>
          <span className="text-xs text-gray-500">
            {currentFrame + 1} / {totalFrames}
          </span>
        </div>

        {/* Map image with overlays */}
        <div className="relative w-full" style={{ paddingBottom: '70%' }}>
          {/* Base map */}
          <img
            src={section.baseImage.src}
            alt={section.baseImage.alt}
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
          />

          {/* Dark overlay for better label readability */}
          <div className="absolute inset-0 bg-black/20" />

          {/* Overlays for current frame */}
          {frame.overlays?.map((overlay, idx) => {
            const style: React.CSSProperties = {
              position: 'absolute',
              left: `${overlay.x}%`,
              top: `${overlay.y}%`,
              transform: 'translate(-50%, -50%)',
              zIndex: overlay.type === 'label' ? 30 : 20,
            };

            if (overlay.type === 'label') {
              return (
                <div
                  key={idx}
                  style={style}
                  className="pointer-events-none animate-fade-in"
                >
                  <span
                    className="text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap shadow-lg"
                    style={{
                      backgroundColor: `${overlay.color || '#22c55e'}22`,
                      color: overlay.color || '#22c55e',
                      border: `1px solid ${overlay.color || '#22c55e'}66`,
                      textShadow: '0 1px 3px rgba(0,0,0,0.8)',
                    }}
                  >
                    {overlay.text}
                  </span>
                </div>
              );
            }

            if (overlay.type === 'flag') {
              return (
                <div
                  key={idx}
                  style={style}
                  className="pointer-events-none animate-fade-in"
                >
                  <img
                    src={overlay.src}
                    alt="CPS flag"
                    className="w-6 h-8 object-contain drop-shadow-lg"
                  />
                </div>
              );
            }

            // Icon type
            return (
              <div
                key={idx}
                style={style}
                className="pointer-events-none animate-fade-in"
              >
                <img
                  src={overlay.src}
                  alt=""
                  className="w-10 h-10 object-contain drop-shadow-lg"
                />
              </div>
            );
          })}

          {/* Progress dots */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 z-40">
            {section.frames.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrentFrame(i)}
                className={`w-2 h-2 rounded-full transition-all ${
                  i === currentFrame
                    ? 'bg-white w-4'
                    : i < currentFrame
                    ? 'bg-white/60'
                    : 'bg-white/30'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Caption + navigation */}
        <div className="p-4 bg-gray-800/80 border-t border-gray-700">
          <p className="text-gray-300 text-sm leading-relaxed mb-4 min-h-[3rem]">
            {frame.caption}
          </p>

          <div className="flex items-center justify-between">
            <button
              onClick={goPrev}
              disabled={currentFrame === 0}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed bg-gray-700 hover:bg-gray-600 text-white"
            >
              <ChevronLeft size={16} />
              Previous
            </button>

            {currentFrame < totalFrames - 1 ? (
              <button
                onClick={goNext}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-purple-600 hover:bg-purple-500 text-white"
              >
                Next Step
                <ChevronRight size={16} />
              </button>
            ) : (
              <span className="text-xs text-green-400 font-medium flex items-center gap-1">
                <CheckCircle size={14} />
                Storyboard complete
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/** Routes a LessonSection to the correct renderer */
/** Renders an embedded YouTube video with heading and optional note */
const VideoSectionRenderer: React.FC<{ section: VideoSection }> = ({ section }) => {
  return (
    <div className="mb-8">
      {section.heading && (
        <h3 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
          <div className="w-1 h-6 bg-red-500 rounded-full flex-shrink-0" />
          {section.heading}
        </h3>
      )}
      {section.description && (
        <p className="text-gray-300 text-sm leading-relaxed mb-3">{section.description}</p>
      )}
      <div className="relative w-full overflow-hidden rounded-lg border border-gray-700" style={{ paddingBottom: '56.25%' }}>
        <iframe
          className="absolute inset-0 w-full h-full"
          src={`https://www.youtube.com/embed/${section.youtubeId}?rel=0`}
          title={section.heading}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
      {section.note && (
        <p className="text-amber-400/80 text-xs mt-2 italic">⚠️ {section.note}</p>
      )}
    </div>
  );
};

const SectionRenderer: React.FC<{ section: LessonSection }> = ({ section }) => {
  switch (section.type) {
    case 'text':
      return <TextSectionRenderer section={section} />;
    case 'image':
      return <ImageSectionRenderer section={section} />;
    case 'storyboard':
      return <StoryboardRenderer section={section} />;
    case 'video':
      return <VideoSectionRenderer section={section} />;
    default:
      return null;
  }
};

// =============================================================================
// MAIN PAGE COMPONENT
// =============================================================================

const TrainingModulePage: React.FC = () => {
  const { moduleId } = useParams<{ moduleId: string }>();
  const navigate = useNavigate();

  const contractor = contractorService.getCurrentTrainingContractor();
  const module = moduleId ? getModuleById(moduleId) : undefined;

  // Redirect guards
  useEffect(() => {
    if (!contractor) navigate('/login');
    if (!module) navigate('/training');
  }, [contractor, module, navigate]);

  // --- VIEW STATE ---
  const [view, setView] = useState<PageView>('lesson');

  // --- QUIZ STATE ---
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [showFeedback, setShowFeedback] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lastAttempt, setLastAttempt] = useState<TrainingAttempt | null>(null);
  const [pastAttempts, setPastAttempts] = useState<TrainingAttempt[]>([]);
  const [alreadyCompleted, setAlreadyCompleted] = useState(false);

  // Load past attempts on mount
  useEffect(() => {
    if (!contractor || !module) return;

    contractorService
      .getAttemptsForContractor(contractor.contractorId)
      .then((all) => {
        const mine = all.filter((a) => a.moduleId === module.module_id);
        setPastAttempts(mine);
      })
      .catch(console.error);

    contractorService
      .getProgressForContractor(contractor.contractorId)
      .then((progress) => {
        const done = progress.find(
          (p) => p.moduleId === module.module_id && p.isCompleted
        );
        setAlreadyCompleted(!!done);
      })
      .catch(console.error);
  }, [contractor?.contractorId, module?.module_id]);

  if (!contractor || !module) return null;

  const quiz = module.quiz;
  const totalQ = quiz.length;

  // --- LESSON: decide between structured or plain text ---
  const hasStructuredSections =
    module.lesson_sections && module.lesson_sections.length > 0;

  const legacyParagraphs = !hasStructuredSections
    ? module.lesson_content.split('\n\n').filter((p) => p.trim().length > 0)
    : [];

  // --- QUIZ HELPERS ---
  const startQuiz = () => {
    setCurrentQuestion(0);
    setSelectedAnswer(null);
    setAnswers([]);
    setShowFeedback(false);
    setLastAttempt(null);
    setView('quiz');
  };

  const handleSelectAnswer = (idx: number) => {
    if (showFeedback) return;
    setSelectedAnswer(idx);
  };

  const handleConfirmAnswer = () => {
    if (selectedAnswer === null) return;
    setShowFeedback(true);
  };

  const handleNextQuestion = () => {
    const newAnswers = [...answers, selectedAnswer];
    setAnswers(newAnswers);
    setShowFeedback(false);
    setSelectedAnswer(null);

    if (currentQuestion + 1 < totalQ) {
      setCurrentQuestion(currentQuestion + 1);
    } else {
      // All questions answered — submit
      submitQuiz(newAnswers);
    }
  };

  const submitQuiz = async (finalAnswers: (number | null)[]) => {
    setSubmitting(true);
    try {
      const score = finalAnswers.reduce<number>((acc, ans, i) => {
        return acc + (ans === quiz[i].correct_index ? 1 : 0);
      }, 0);

      const attempt = await contractorService.submitQuizAttempt(
        contractor.contractorId,
        contractor.commandCenterId,
        module.module_id,
        score,
        totalQ
      );

      setLastAttempt(attempt);
      setPastAttempts((prev) => [attempt, ...prev]);

      if (attempt.passed) {
        setAlreadyCompleted(true);
      }

      setView('results');
    } catch (err) {
      console.error('Failed to submit quiz:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const currentQ = quiz[currentQuestion];
  const isCorrect = selectedAnswer === currentQ?.correct_index;

  // --- RESULTS CALCULATIONS ---
  const score = lastAttempt?.score ?? 0;
  const pct = lastAttempt ? Math.round((score / totalQ) * 100) : 0;
  const passed = lastAttempt?.passed ?? false;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <button
            onClick={() => (view === 'lesson' ? navigate('/training') : setView('lesson'))}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <ArrowLeft size={22} />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-500 uppercase tracking-wide">
              Module {module.order_index}
            </p>
            <h1 className="font-bold text-white text-sm truncate">{module.title}</h1>
          </div>
          {alreadyCompleted && (
            <span className="text-xs bg-green-900/40 text-green-400 px-2 py-1 rounded border border-green-700/40 flex-shrink-0 flex items-center gap-1">
              <CheckCircle size={12} /> Completed
            </span>
          )}
        </div>

        {/* Tab switcher */}
        {view !== 'results' && (
          <div className="max-w-3xl mx-auto mt-3 flex gap-2">
            <button
              onClick={() => setView('lesson')}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                view === 'lesson'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <BookOpen size={14} className="inline mr-1.5" />
              Lesson
            </button>
            <button
              onClick={() => setView('quiz')}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                view === 'quiz'
                  ? 'bg-purple-600 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Quiz ({totalQ} questions)
            </button>
          </div>
        )}
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* ======================== LESSON VIEW ======================== */}
        {view === 'lesson' && (
          <div>
            {/* Past attempts notice */}
            {pastAttempts.length > 0 && (
              <div className="mb-6 p-3 bg-gray-900 border border-gray-800 rounded-lg text-xs text-gray-400 flex items-center gap-2">
                <AlertCircle size={14} className="text-yellow-400 flex-shrink-0" />
                You have {pastAttempts.length} previous quiz attempt
                {pastAttempts.length > 1 ? 's' : ''} on this module.
              </div>
            )}

            {/* Structured sections (modules 2 & 3) */}
            {hasStructuredSections ? (
              <div>
                {module.lesson_sections!.map((section, i) => (
                  <SectionRenderer key={i} section={section} />
                ))}
              </div>
            ) : (
              /* Legacy plain-text rendering (modules 1, 4, 5) */
              <div className="space-y-5 mb-10">
                {legacyParagraphs.map((para, i) => (
                  <p key={i} className="text-gray-300 leading-relaxed text-sm">
                    {para}
                  </p>
                ))}
              </div>
            )}

            {/* CTA to quiz */}
            <div className="border-t border-gray-800 pt-8 text-center">
              <h3 className="text-white font-bold text-lg mb-2">
                Ready to test your knowledge?
              </h3>
              <p className="text-gray-400 text-sm mb-6">
                You need {Math.round(QUIZ_PASS_THRESHOLD * 100)}% or higher to pass. You
                can retry as many times as you like.
              </p>
              <button
                onClick={startQuiz}
                className="bg-purple-600 hover:bg-purple-500 text-white px-8 py-3 rounded-xl font-bold flex items-center gap-2 mx-auto transition-colors"
              >
                {alreadyCompleted ? (
                  <>
                    <RotateCcw size={18} /> Retake Quiz
                  </>
                ) : (
                  <>
                    Start Quiz <ChevronRight size={18} />
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* ======================== QUIZ VIEW ======================== */}
        {view === 'quiz' && !submitting && (
          <div>
            {/* Progress bar */}
            <div className="mb-6">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>
                  Question {currentQuestion + 1} of {totalQ}
                </span>
                <span>{Math.round((currentQuestion / totalQ) * 100)}% done</span>
              </div>
              <div className="w-full bg-gray-800 rounded-full h-2">
                <div
                  className="bg-purple-500 h-2 rounded-full transition-all"
                  style={{ width: `${(currentQuestion / totalQ) * 100}%` }}
                />
              </div>
            </div>

            {/* Question */}
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 mb-4">
              <p className="text-white font-bold text-base mb-6 leading-relaxed">
                {currentQ.question}
              </p>

              {/* Options */}
              <div className="space-y-3">
                {currentQ.options.map((option, idx) => {
                  let style =
                    'bg-gray-800 border-gray-700 text-gray-200 hover:border-purple-500';

                  if (showFeedback) {
                    if (idx === currentQ.correct_index) {
                      style = 'bg-green-900/30 border-green-500 text-green-200';
                    } else if (idx === selectedAnswer && idx !== currentQ.correct_index) {
                      style = 'bg-red-900/30 border-red-500 text-red-200';
                    } else {
                      style = 'bg-gray-800 border-gray-700 text-gray-500';
                    }
                  } else if (selectedAnswer === idx) {
                    style = 'bg-purple-900/30 border-purple-500 text-white';
                  }

                  return (
                    <button
                      key={idx}
                      onClick={() => handleSelectAnswer(idx)}
                      className={`w-full text-left px-4 py-3 rounded-lg border transition-all text-sm ${style}`}
                    >
                      <span className="font-bold mr-2 text-gray-500">
                        {String.fromCharCode(65 + idx)}.
                      </span>
                      {option}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Feedback */}
            {showFeedback && (
              <div
                className={`rounded-xl p-4 mb-4 flex items-start gap-3 ${
                  isCorrect
                    ? 'bg-green-900/20 border border-green-700/50'
                    : 'bg-red-900/20 border border-red-700/50'
                }`}
              >
                {isCorrect ? (
                  <CheckCircle
                    className="text-green-400 flex-shrink-0 mt-0.5"
                    size={18}
                  />
                ) : (
                  <XCircle className="text-red-400 flex-shrink-0 mt-0.5" size={18} />
                )}
                <div>
                  <p
                    className={`font-bold text-sm mb-1 ${
                      isCorrect ? 'text-green-300' : 'text-red-300'
                    }`}
                  >
                    {isCorrect ? 'Correct!' : 'Not quite.'}
                  </p>
                  <p className="text-gray-300 text-xs leading-relaxed">
                    {currentQ.explanation}
                  </p>
                </div>
              </div>
            )}

            {/* Action buttons */}
            {!showFeedback ? (
              <button
                onClick={handleConfirmAnswer}
                disabled={selectedAnswer === null}
                className="w-full bg-purple-600 hover:bg-purple-500 text-white py-3 rounded-xl font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Confirm Answer
              </button>
            ) : (
              <button
                onClick={handleNextQuestion}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-xl font-bold transition-colors flex items-center justify-center gap-2"
              >
                {currentQuestion + 1 < totalQ ? (
                  <>
                    Next Question <ChevronRight size={18} />
                  </>
                ) : (
                  'See Results'
                )}
              </button>
            )}
          </div>
        )}

        {/* Submitting state */}
        {submitting && (
          <div className="text-center py-20 animate-pulse text-gray-400">
            Saving your results...
          </div>
        )}

        {/* ======================== RESULTS VIEW ======================== */}
        {view === 'results' && lastAttempt && (
          <div className="text-center">
            <div
              className={`w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-6 text-4xl font-black ${
                passed
                  ? 'bg-green-900/30 border-2 border-green-500 text-green-400'
                  : 'bg-red-900/30 border-2 border-red-500 text-red-400'
              }`}
            >
              {pct}%
            </div>

            {passed ? (
              <>
                <Trophy className="text-yellow-400 mx-auto mb-3" size={32} />
                <h2 className="text-2xl font-black text-white mb-2">Module Passed!</h2>
                <p className="text-gray-400 mb-1">
                  You scored {score} out of {totalQ} questions correctly.
                </p>
                <p className="text-green-400 text-sm mb-8">
                  This module is now marked as complete on your profile.
                </p>
              </>
            ) : (
              <>
                <XCircle className="text-red-400 mx-auto mb-3" size={32} />
                <h2 className="text-2xl font-black text-white mb-2">Not Quite</h2>
                <p className="text-gray-400 mb-1">
                  You scored {score} out of {totalQ}. You need{' '}
                  {Math.round(QUIZ_PASS_THRESHOLD * 100)}% to pass.
                </p>
                <p className="text-gray-500 text-sm mb-8">
                  Review the lesson and try again — there's no limit on retries.
                </p>
              </>
            )}

            {/* Past attempts */}
            {pastAttempts.length > 1 && (
              <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 mb-8 text-left">
                <h4 className="text-sm font-bold text-gray-400 mb-3">
                  Your Attempt History
                </h4>
                <div className="space-y-2">
                  {pastAttempts.slice(0, 5).map((a, i) => (
                    <div
                      key={a.id}
                      className="flex items-center justify-between text-xs text-gray-500"
                    >
                      <span>
                        {i === 0 ? 'Latest' : `Attempt ${pastAttempts.length - i}`}
                      </span>
                      <span>
                        {a.score}/{a.totalQuestions} (
                        {Math.round((a.score / a.totalQuestions) * 100)}%)
                      </span>
                      <span className={a.passed ? 'text-green-400' : 'text-red-400'}>
                        {a.passed ? 'Passed' : 'Failed'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex flex-col gap-3">
              <button
                onClick={startQuiz}
                className="w-full bg-purple-600 hover:bg-purple-500 text-white py-3 rounded-xl font-bold transition-colors flex items-center justify-center gap-2"
              >
                <RotateCcw size={18} /> Retake Quiz
              </button>
              <button
                onClick={() => setView('lesson')}
                className="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 py-3 rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
              >
                <BookOpen size={18} /> Review Lesson
              </button>
              <button
                onClick={() => navigate('/training')}
                className="w-full text-gray-500 hover:text-gray-300 py-2 transition-colors text-sm"
              >
                ← Back to All Modules
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Fade-in animation for storyboard overlays */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
          to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
        .animate-fade-in {
          animation: fadeIn 0.3s ease-out forwards;
        }
      `}</style>
    </div>
  );
};

export default TrainingModulePage;